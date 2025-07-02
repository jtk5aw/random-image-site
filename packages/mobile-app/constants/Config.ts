export const getApiEndpoint = (): string => {
  const apiEndpoint = process.env.EXPO_PUBLIC_API_URL;
  console.log("Endpoint is: " + apiEndpoint);

  if (!apiEndpoint) {
    throw new Error("API_ENDPOINT not found in Info.plist");
  }

  return apiEndpoint;
};
