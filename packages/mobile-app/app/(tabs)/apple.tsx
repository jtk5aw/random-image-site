import * as AppleAuthentication from "expo-apple-authentication";
import { useState, useEffect } from "react";
import { View, StyleSheet, Text, Button } from "react-native";
import * as SecureStore from "expo-secure-store";
import * as Keychain from "react-native-keychain";
import { AppType } from "../../../mobile-backend";
import { ClientRequest, ClientResponse, InferResponseType } from "hono/client";
import { ContentfulStatusCode } from "hono/utils/http-status";
// I don't know why the require is necessary here but it works for now :shrug:
const { hc } = require("hono/dist/client") as typeof import("hono/client");

// TODO: This is a general todo for the code base but, its possible to check if a token
// is expired before making a request with it. Might be worthwhile to add some short circuting around that
// in here and in the share sheet

const client = hc<AppType>("https://mobile.jacksonkennedy.jtken.com");

const ACCESS_TOKEN_SECURE_STORE_KEY = "accessToken";
const REFRESH_TOKEN_SECURE_STORE_KEY = "refreshToken";
const SHARED_KEYCHAIN_GROUP = "7XNW9F5V9P.com.jtken.randomimagesite";

// Makes request to refresh credentials if necessary
interface BearerToken {
  header: {
    Authorization: string;
  };
}
// Helper type to determine if a type is from the refresh endpoint
// Assuming InferResponseType<typeof client.refresh.$post> is a defined type, let's call it RefreshResponse for clarity
type RefreshResponse = InferResponseType<typeof client.refresh.$post>;
type Credentials = {
  accessToken: string;
  refreshToken: string;
};

// Case 1: Initial successful response (type T)
interface InitialResponse<T> {
  status: "initial_success";
  response: T;
  creds: undefined;
}

// Case 2: Successful refresh response (type RefreshResponse) AND new creds are provided
interface RefreshSuccessResponse {
  status: "refresh_success"; // Discriminant property
  response: RefreshResponse;
  creds: Credentials;
}

// Case 3: Refresh response (type RefreshResponse) BUT no new creds are provided
interface RefreshFailedNoCredsResponse {
  status: "refresh_failed_no_creds";
  response: RefreshResponse;
  creds: undefined;
}

// Case 4: Exception occurred
interface RequestFailure {
  status: "request_failure";
  message: string;
}

type ResponseAndNewCreds<T> =
  | InitialResponse<T>
  | RefreshSuccessResponse
  | RefreshFailedNoCredsResponse
  | RequestFailure;

async function makeCall<I extends BearerToken, O>(
  call: ClientRequest<{
    $post: {
      input: I;
      output: O;
      outputFormat: "json";
      status: ContentfulStatusCode;
    };
  }>,
  input: I,
  refreshToken: string | null,
): Promise<ResponseAndNewCreds<O>> {
  try {
    const result = await call.$post(input);
    const resultJson = await result.json();
    // First call either succeeded or was a non access denied error
    if (result.ok || (!result.ok && result.status != 401)) {
      return {
        status: "initial_success",
        response: resultJson,
        creds: undefined,
      };
    }
    if (!refreshToken) {
      return {
        status: "refresh_failed_no_creds",
        response: resultJson,
        creds: undefined,
      };
    }
    // First call was an access denied and we have a refresh token. Attempt to refresh tokens
    const refreshCreds = await client.refresh.$post({
      header: {
        refresh_token: refreshToken,
      },
    });
    const refreshJson = await refreshCreds.json();
    if (refreshJson.success == false) {
      console.log(refreshJson.message);
      return {
        status: "refresh_failed_no_creds",
        response: refreshJson,
        creds: undefined,
      };
    }
    const tokens = refreshJson.value;
    input.header.Authorization = `Bearer ${tokens.accessToken}`;
    const newCredsResult = await call.$post(input);
    const newCredsResultJson = await newCredsResult.json();
    return {
      status: "refresh_success",
      response: newCredsResultJson,
      creds: tokens,
    };
  } catch (e) {
    console.log("Exception occurred: " + e);
    return { status: "request_failure", message: JSON.stringify(e) };
  }
}

async function makeJunkLoginCall() {
  const result = await client.login.$post({
    header: {
      apple_token: "token",
    },
  });
  const json = await result.json();
  if (json.success == true) {
  }
  console.log(await result.json());
}

async function makeTestCall(
  credential: string,
  refreshCredential: string | null,
): Promise<
  | undefined
  | { refreshSuccess: true; credentials: Credentials }
  | { refreshSuccess: false }
> {
  const result = await makeCall(
    client.api.test,
    {
      header: {
        Authorization: `Bearer ${credential}`,
      },
    },
    refreshCredential,
  );
  console.log(result.status);
  if (result.status === "refresh_success") {
    return { refreshSuccess: true, credentials: result.creds };
  }
  if (result.status === "refresh_failed_no_creds") {
    return { refreshSuccess: false };
  }
  return;
}

export default function App() {
  const [credential, setCredential] = useState(null);
  const [refreshCredential, setRefreshCredential] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loginInProgress, setLoginInProgress] = useState(false);

  async function clearStorage() {
    await Keychain.resetGenericPassword({
      service: ACCESS_TOKEN_SECURE_STORE_KEY,
      accessGroup: SHARED_KEYCHAIN_GROUP,
    });
    await Keychain.resetGenericPassword({
      service: REFRESH_TOKEN_SECURE_STORE_KEY,
      accessGroup: SHARED_KEYCHAIN_GROUP,
    });

    setCredential(null);
    setRefreshCredential(null);
  }

  // Load credentials from SecureStore on component mount
  useEffect(() => {
    async function loadCredential() {
      try {
        const accessTokenCredential = await Keychain.getGenericPassword({
          service: ACCESS_TOKEN_SECURE_STORE_KEY,
          accessGroup: SHARED_KEYCHAIN_GROUP,
        });
        if (
          !accessTokenCredential ||
          accessTokenCredential.username != ACCESS_TOKEN_SECURE_STORE_KEY
        ) {
          throw Error("Failed to retrieve access token");
        }
        setCredential(accessTokenCredential.password);
        const refreshTokenCredential = await Keychain.getGenericPassword({
          service: REFRESH_TOKEN_SECURE_STORE_KEY,
          accessGroup: SHARED_KEYCHAIN_GROUP,
        });
        if (
          !refreshTokenCredential ||
          refreshTokenCredential.username != REFRESH_TOKEN_SECURE_STORE_KEY
        ) {
          throw Error("Failed to retrieve refresh token");
        }
        setRefreshCredential(refreshTokenCredential.password);
      } catch (error) {
        console.error("Failed to load credential:", error);
      } finally {
        setLoading(false);
      }
    }

    loadCredential();
  }, []);

  const storeCreds = async (accessToken: string, refreshToken: string) => {
    await Keychain.setGenericPassword(
      ACCESS_TOKEN_SECURE_STORE_KEY,
      accessToken,
      {
        service: ACCESS_TOKEN_SECURE_STORE_KEY,
        accessGroup: SHARED_KEYCHAIN_GROUP,
      },
    );
    setCredential(accessToken);
    await Keychain.setGenericPassword(
      REFRESH_TOKEN_SECURE_STORE_KEY,
      refreshToken,
      {
        service: REFRESH_TOKEN_SECURE_STORE_KEY,
        accessGroup: SHARED_KEYCHAIN_GROUP,
      },
    );
    setRefreshCredential(refreshToken);
  };

  const refreshAppleCredentials = async () => {
    if (!refreshCredential) {
      console.log("FAILURE");
      return;
    }
    try {
      const result = await client.refresh.$post({
        header: {
          refresh_token: refreshCredential,
        },
      });
      const json = await result.json();
      if (json.success == false) {
        console.log("FAILURE");
        console.log(json);
        return;
      }
      storeCreds(json.value.accessToken, json.value.refreshToken);
    } catch (e) {
      console.log("FAILURE");
      console.log(e);
    }
  };

  const fetchAppleCredentials = async (
    credentialPromise: Promise<AppleAuthentication.AppleAuthenticationCredential>,
  ) => {
    try {
      const appleCredential = await credentialPromise;
      if (appleCredential.identityToken) {
        // Set login in progress to show blank screen while login API call is in progress
        setLoginInProgress(true);

        const result = await client.login.$post({
          header: {
            apple_token: appleCredential.identityToken,
          },
        });
        let json = await result.json();

        // Login process complete, revert to normal screen
        setLoginInProgress(false);

        if (json.success == false) {
          console.log("FAILED");
          console.log(json);
          return;
        }
        const payload = json.value;
        storeCreds(payload.accessToken, payload.refreshToken);
      }
    } catch (e) {
      // Reset login in progress in case of error
      setLoginInProgress(false);

      if (e.code === "ERR_REQUEST_CANCELED") {
        // handle that the user canceled the sign-in flow
        console.log("Sign in canceled");
      } else {
        // handle other errors
        console.error("Apple sign in error:", e);
      }
    }
  };

  const handleAppleSignIn = async () => {
    fetchAppleCredentials(
      AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
      }),
    );
  };

  const handleAppleRefresh = async () => {
    let user;
    try {
      console.log("fetching user");
      // Maybe move this to Keychain? I don't think I actually really use it though so maybe also just delete it?
      user = await SecureStore.getItemAsync("user");
      if (!user) {
        console.log("didn't find user");
        throw new Error(
          "Do not have access to a user, probably need to rest sign in",
        );
      }
    } catch (e) {
      console.log("Failed to get user");
      throw new Error(
        "Failure while fetching user from storage: " + JSON.stringify(e),
      );
    }
    fetchAppleCredentials(
      AppleAuthentication.refreshAsync({
        user: user,
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
      }),
    );
  };

  if (loading) {
    return (
      <View style={styles.container}>
        <Text>Loading...</Text>
      </View>
    );
  }

  // Show blank screen during login API call
  if (loginInProgress) {
    return <View style={styles.container} />;
  }

  return (
    <View style={styles.container}>
      {credential ? (
        <View>
          <Button
            title="Does nothing lolz"
            onPress={() => console.log(credential)}
          />
          <Button
            title="Make test call"
            onPress={async () => {
              const testCallResult = await makeTestCall(
                credential,
                refreshCredential,
              );
              if (testCallResult === undefined) {
                return;
              }
              if (testCallResult.refreshSuccess) {
                storeCreds(
                  testCallResult.credentials.accessToken,
                  testCallResult.credentials.refreshToken,
                );
              } else {
                clearStorage();
              }
            }}
          />
          <Button
            title="Make Junk Login Call"
            onPress={() => makeJunkLoginCall()}
          />
          <Button
            title="Refresh tokens"
            onPress={() => refreshAppleCredentials()}
          />
          <Button title="Sign in again" onPress={() => handleAppleRefresh()} />
          <Button title="Clear credentials" onPress={() => clearStorage()} />
        </View>
      ) : (
        <AppleAuthentication.AppleAuthenticationButton
          buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
          buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
          cornerRadius={5}
          style={styles.button}
          onPress={handleAppleSignIn}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 20,
  },
  button: {
    width: 200,
    height: 44,
  },
  text: {
    fontSize: 18,
    textAlign: "center",
    marginBottom: 20,
  },
});
