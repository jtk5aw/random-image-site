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

const client = hc<AppType>("https://jacksonkennedy.mobile.jtken.com");

const ACCESS_TOKEN_SECURE_STORE_KEY = "accessToken";
const REFRESH_TOKEN_SECURE_STORE_KEY = "refreshToken";
const CLIENT_ID = "com.jtken.randomimagesite";
const SHARED_KEYCHAIN_GROUP = "7XNW9F5V9P.com.jtken.randomimagesite";

// Makes request to refresh credentials if necessary
interface BearerToken {
  header: {
    Authorization: string;
  };
}
interface ResponseAndNewCreds<T> {
  response: T | InferResponseType<typeof client.refresh.$post>;
  creds:
    | {
        accessToken: string;
        refreshToken: string;
      }
    | undefined;
}
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
  const result = await call.$post(input);
  const resultJson = await result.json();
  // First call either succeeded or was a non access denied error
  if (result.ok || (!result.ok && result.status != 401)) {
    return { response: resultJson, creds: undefined };
  }
  if (!refreshToken) {
    return { response: resultJson, creds: undefined };
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
    return { response: refreshJson, creds: undefined };
  }
  const tokens = refreshJson.value;
  input.header.Authorization = `Bearer ${tokens.accessToken}`;
  const newCredsResult = await call.$post(input);
  const newCredsResultJson = await newCredsResult.json();
  return { response: newCredsResultJson, creds: tokens };
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
) {
  const result = await makeCall(
    client.api.test,
    {
      header: {
        Authorization: `Bearer ${credential}`,
      },
    },
    refreshCredential,
  );
  console.log(result);
  return result.creds;
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
    console.log("Refresh token: " + refreshCredential);
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
              const creds = await makeTestCall(credential, refreshCredential);
              if (creds) {
                storeCreds(creds.accessToken, creds.refreshToken);
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
