import * as AppleAuthentication from "expo-apple-authentication";
import { useState, useEffect } from "react";
import { View, StyleSheet, Text, Button } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

// TODO: WARNING: Shouldn't be using AsyncStorage for a user cred like this
// need to put that into encrypted storage instead

async function makeRequest(credential: string) {
  try {
    console.log("test");
    let result = await fetch(
      "https://qhwiwogppcugivxw6ctskiv33a0wceer.lambda-url.us-west-1.on.aws/apple",
      {
        headers: {
          Authorization: "Bearer " + credential,
        },
      },
    )
      .then((response) => response.json())
      .catch((err) => {
        console.log(err);
        return null;
      });
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

  const handleAppleSignIn = async () => {
    try {
      const appleCredential = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
      });

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
