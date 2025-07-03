import AsyncStorage from '@react-native-async-storage/async-storage';

export const getUuid = async (): Promise<string | null> => {
  try {
    return await AsyncStorage.getItem('uuid');
  } catch (error) {
    console.error('Error getting UUID from storage:', error);
    return null;
  }
};

export const setUuid = async (uuid: string): Promise<void> => {
  try {
    await AsyncStorage.setItem('uuid', uuid);
  } catch (error) {
    console.error('Error setting UUID in storage:', error);
  }
};