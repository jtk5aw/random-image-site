import * as AppleAuthentication from "expo-apple-authentication";
import { useState, useEffect } from "react";
import { View, StyleSheet, Text, Button } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { AppType } from "../../../mobile-backend";
// I don't know why the require is necessary here but it works for now :shrug:
const { hc } = require("hono/dist/client") as typeof import("hono/client");

const client = hc<AppType>(
  "https://zsqsgmp3bajrmuq6tmqm5frzfy0btrtq.lambda-url.us-west-1.on.aws",
);

// TODO : Need to use SecureStorage instead of AsyncStorage

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

async function makeTestCall(credential: string) {
  const result = await client.api.test.$post({
    header: {
      Authorization: `Bearer ${credential}`,
    },
  });
  console.log(await result.json());
}

export default function App() {
  const [credential, setCredential] = useState(null);
  const [refreshCredential, setRefreshCredential] = useState(null);
  const [loading, setLoading] = useState(true);

  async function clearStorage() {
    await AsyncStorage.clear();
    setCredential(null);
  }

  // Load credentials from AsyncStorage on component mount
  useEffect(() => {
    async function loadCredential() {
      try {
        const storedCredential = await AsyncStorage.getItem("credential");
        setCredential(storedCredential);
        const storedRefreshCredential =
          await AsyncStorage.getItem("refreshToken");
        setRefreshCredential(storedRefreshCredential);
      } catch (error) {
        console.error("Failed to load credential:", error);
      } finally {
        setLoading(false);
      }
    }

    loadCredential();
  }, []);

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
      AsyncStorage.setItem("credential", json.value.accessToken);
      setCredential(json.value.accessToken);
      AsyncStorage.setItem("refreshToken", json.value.refreshToken);
      setRefreshCredential(json.value.refreshToken);
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
        const result = await client.login.$post({
          header: {
            apple_token: appleCredential.identityToken,
          },
        });
        let json = await result.json();
        if (json.success == false) {
          console.log("FAILED");
          console.log(json);
          return;
        }
        const payload = json.value;
        AsyncStorage.setItem("credential", payload.accessToken);
        AsyncStorage.setItem("refreshToken", payload.refreshToken);
        setCredential(payload.accessToken);
        setRefreshCredential(payload.refreshToken);
      }
    } catch (e) {
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
      user = await AsyncStorage.getItem("user");
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
            onPress={() => makeTestCall(credential)}
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
