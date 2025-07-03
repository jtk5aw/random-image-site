import React from 'react';
import { Image, StyleSheet, TouchableOpacity, Dimensions } from 'react-native';

interface DailyImageProps {
  url: string;
  alt: string;
  onPress?: (url: string) => void;
}

const { width: screenWidth } = Dimensions.get('window');

export default function DailyImage({ url, alt, onPress }: DailyImageProps) {
  const handlePress = () => {
    if (onPress) {
      onPress(url);
    }
  };

  const ImageComponent = onPress ? TouchableOpacity : React.Fragment;
  const imageProps = onPress ? { onPress: handlePress } : {};

  return (
    <ImageComponent {...imageProps}>
      <Image 
        source={{ uri: url }}
        style={styles.image}
        resizeMode="contain"
        accessibilityLabel={alt}
      />
    </ImageComponent>
  );
}

const styles = StyleSheet.create({
  image: {
    width: screenWidth - 32, // Account for padding
    height: screenWidth - 32, // Square aspect ratio, adjust as needed
    maxWidth: 400,
    maxHeight: 400,
  },
});