// Get API URL from environment variables if available
const BASE_API =
  process.env.EXPO_PUBLIC_IMAGE_API_URL || "https://api.bad.jtken.com";

export const TODAYS_IMAGE_ENDPOINT = BASE_API + "/todays-image";
export const TODAYS_METADATA_ENDPOINT = BASE_API + "/todays-metadata";
export const SET_FAVORITE_ENDPOINT = BASE_API + "/set-favorite";
