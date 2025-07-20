export const getApiEndpoint = (): string => {
  const apiEndpoint = process.env.EXPO_PUBLIC_API_URL;
  console.log("Endpoint is: " + apiEndpoint);

  if (!apiEndpoint) {
    throw new Error("API_ENDPOINT not found in Info.plist");
  }

  return apiEndpoint;
};

// TODO TODO TODO: I think the app is good to publish at this point, just
// need to figure out how

export const showAdminPanel = (): boolean => {
  console.log(process.env.EXPO_PUBLIC_SHOW_ADMIN);
  const toReturn = process.env.EXPO_PUBLIC_SHOW_ADMIN === "true";
  console.log("ShowAdminPanel: ", toReturn);
  return toReturn;
};
