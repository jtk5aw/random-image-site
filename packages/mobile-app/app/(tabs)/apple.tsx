import * as AppleAuthentication from "expo-apple-authentication";
import { useState, useEffect } from "react";
import { View, StyleSheet, Text, Button } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { AppType } from "../../../mobile-backend";
// I don't know why the require is necessary here but it works for now :shrug:
const { hc } = require("hono/dist/client") as typeof import("hono/client");

const client = hc<AppType>(
  "https://qhwiwogppcugivxw6ctskiv33a0wceer.lambda-url.us-west-1.on.aws",
);

// TODO: WARNING: Shouldn't be using AsyncStorage for a user cred like this
// need to put that into encrypted storage instead
//
// TODO TODO TODO: Need to do what's laid out here:
// https://stackoverflow.com/questions/78549427/how-do-i-refresh-my-apple-login-in-my-react-native-app-without-user-prompt-and
// Once I get the token here on the front end I need to send that to the backend to do the requesting. In order to do that I need to onboard to
// get a client secret
// I have the cert in my downloads folder and I'll have to use it to make a jwt to call apple with here https://stackoverflow.com/questions/78549427/how-do-i-refresh-my-apple-login-in-my-react-native-app-without-user-prompt-and
async function makeRequest(credential: string) {
  try {
    const response = await client.test.apple.$post({
      header: { authorization: "Bearer " + credential },
      json: {},
    });

    // Check if response is ok (status 200-299)
    if (!response.ok) {
      const result = await response.json();
      throw new Error(
        `HTTP error! Status: ${response.status} - ${JSON.stringify(result)}`,
      );
    }

    // Get content type from headers
    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) {
      throw new Error(`Bad Output returned. Not json`);
    }

    // Handle JSON response
    const result = await response.json();
    console.log("name is: " + result.name);

    console.log(result);
    return result;
  } catch (err) {
    console.log(err);
    return null;
  }
}

export default function App() {
  const [credential, setCredential] = useState(null);
  const [loading, setLoading] = useState(true);

  async function clearStorage() {
    await AsyncStorage.clear();
    setCredential(null);
  }

  // Load credential from AsyncStorage on component mount
  useEffect(() => {
    async function loadCredential() {
      try {
        const storedCredential = await AsyncStorage.getItem("credential");
        setCredential(storedCredential);
      } catch (error) {
        console.error("Failed to load credential:", error);
      } finally {
        setLoading(false);
      }
    }

    loadCredential();
  }, []);

  const fetchAppleCredentials = async (
    credentialPromise: Promise<AppleAuthentication.AppleAuthenticationCredential>,
  ) => {
    try {
      const appleCredential = await credentialPromise;
      if (appleCredential.user) {
        await AsyncStorage.setItem("user", appleCredential.user);
      }
      if (appleCredential.identityToken) {
        // Store credential token
        await AsyncStorage.setItem("credential", appleCredential.identityToken);
        // Update state
        setCredential(appleCredential.identityToken);
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
          <Text style={styles.text}>You are authenticated!</Text>
          <Button
            title="Make API Request"
            onPress={() => makeRequest(credential)}
          />
          <Button
            title="Refresh api key"
            onPress={() => handleAppleRefresh()}
          />
          <Button title="Clear api key" onPress={() => clearStorage()} />
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
