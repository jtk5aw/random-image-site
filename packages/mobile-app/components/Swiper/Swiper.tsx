import React, { useState, useEffect } from "react";
import {
  View,
  StyleSheet,
  Image,
  Dimensions,
  Text,
  TouchableOpacity,
  FlatList,
  Modal,
  Pressable,
  BackHandler,
} from "react-native";
import { format } from "date-fns";
import axios from "axios";
import { SET_FAVORITE_ENDPOINT } from "@/config/api";
import { getUuid } from "@/utils/storage";

interface SwiperProps {
  images: Array<{
    url: string;
    date: string;
  }>;
  onClose: () => void;
  currentFavorite?: string;
  onFavoriteChange?: (newFavorite: string) => void;
}

const { width, height } = Dimensions.get("window");

export default function Swiper({
  images,
  onClose,
  currentFavorite = "",
  onFavoriteChange,
}: SwiperProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [uuid, setUuid] = useState<string | null>(null);
  const [favoriteUrl, setFavoriteUrl] = useState(currentFavorite);
  const [isClosing, setIsClosing] = useState(false);
  const [modalVisible, setModalVisible] = useState(true);
  const flatListRef = React.useRef<FlatList>(null);

  // Create a controlled close function
  const handleClose = () => {
    setIsClosing(true);
    // First set the modal to invisible with fade animation
    setModalVisible(false);
    // Then call the actual onClose after the animation completes
    setTimeout(() => {
      onClose();
    }, 300); // Match this with the fade animation duration
  };

  // Handle back button press to close the swiper
  useEffect(() => {
    const backHandler = BackHandler.addEventListener(
      "hardwareBackPress",
      () => {
        handleClose();
        return true;
      },
    );

    return () => backHandler.remove();
  }, [onClose]);

  // Get UUID for API calls
  useEffect(() => {
    const loadUuid = async () => {
      const storedUuid = await getUuid();
      if (storedUuid) {
        setUuid(storedUuid);
      }
    };
    loadUuid();
  }, []);
  
  // Update favoriteUrl when currentFavorite prop changes
  useEffect(() => {
    setFavoriteUrl(currentFavorite);
  }, [currentFavorite]);

  const goToNext = () => {
    if (currentIndex < images.length - 1) {
      const nextIndex = currentIndex + 1;
      flatListRef.current?.scrollToIndex({
        index: nextIndex,
        animated: true,
      });
      setCurrentIndex(nextIndex);
    }
  };

  const goToPrevious = () => {
    if (currentIndex > 0) {
      const prevIndex = currentIndex - 1;
      flatListRef.current?.scrollToIndex({
        index: prevIndex,
        animated: true,
      });
      setCurrentIndex(prevIndex);
    }
  };

  const handleScroll = (event: any) => {
    // Don't update the index if we're in the process of closing
    if (isClosing) return;
    
    const contentOffsetX = event.nativeEvent.contentOffset.x;
    const newIndex = Math.round(contentOffsetX / width);
    if (
      newIndex !== currentIndex &&
      newIndex >= 0 &&
      newIndex < images.length
    ) {
      setCurrentIndex(newIndex);
    }
  };

  const formatDate = (dateString: string) => {
    try {
      const date = new Date(dateString);
      return format(date, "MMMM d, yyyy");
    } catch (e) {
      return dateString;
    }
  };

  const toggleFavorite = async () => {
    if (!uuid) return;

    const currentImage = images[currentIndex];
    const newFavoriteUrl =
      currentImage.url === favoriteUrl ? "" : currentImage.url;

    console.log('Toggling favorite:', {
      currentImageUrl: currentImage.url,
      oldFavoriteUrl: favoriteUrl,
      newFavoriteUrl,
      action: currentImage.url === favoriteUrl ? 'removing' : 'setting'
    });

    // Optimistically update UI
    setFavoriteUrl(newFavoriteUrl);
    
    // Always call onFavoriteChange to update parent state
    if (onFavoriteChange) {
      console.log('Calling onFavoriteChange with:', newFavoriteUrl);
      onFavoriteChange(newFavoriteUrl);
    }

    try {
      // Make API call to update favorite
      console.log('Sending API request to update favorite');
      await axios.put(SET_FAVORITE_ENDPOINT, {
        favorite_image: newFavoriteUrl,
        uuid,
      });
      
      console.log('API request successful, closing slider');
      // Close the slider after setting favorite
      handleClose();
    } catch (error) {
      console.error("Error setting favorite:", error);
      // Revert on error
      setFavoriteUrl(favoriteUrl);
      if (onFavoriteChange) {
        onFavoriteChange(favoriteUrl);
      }
    }
  };

  if (images.length === 0) {
    return (
      <Modal
        animationType="fade"
        transparent={true}
        visible={modalVisible}
        onRequestClose={handleClose}
      >
        <View style={styles.container}>
          <Text style={styles.noImagesText}>No recent images available</Text>
          <TouchableOpacity style={styles.closeButton} onPress={handleClose}>
            <Text style={styles.closeButtonText}>Close</Text>
          </TouchableOpacity>
        </View>
      </Modal>
    );
  }

  const renderItem = ({ item }: { item: { url: string; date: string } }) => (
    <Pressable style={styles.slide} onPress={handleClose}>
      <Image
        source={{ uri: item.url }}
        style={styles.image}
        resizeMode="contain"
      />
    </Pressable>
  );

  const currentImage = images[currentIndex];
  // Calculate isFavorite based on current image and favoriteUrl
  const [isFavorite, setIsFavorite] = useState(currentImage.url === favoriteUrl);
  
  // Update isFavorite when currentIndex or favoriteUrl changes
  useEffect(() => {
    if (images.length > 0) {
      const newIsFavorite = images[currentIndex].url === favoriteUrl;
      setIsFavorite(newIsFavorite);
      console.log('Favorite status updated:', {
        currentImageUrl: images[currentIndex].url,
        favoriteUrl,
        isFavorite: newIsFavorite
      });
    }
  }, [currentIndex, favoriteUrl, images]);

  return (
    <Modal
      animationType="fade"
      transparent={true}
      visible={modalVisible}
      onRequestClose={handleClose}
    >
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.dateText}>{formatDate(currentImage.date)}</Text>
          <Text style={styles.counterText}>
            {currentIndex + 1} / {images.length}
          </Text>
        </View>

        <TouchableOpacity
          style={styles.closeIcon}
          onPress={handleClose}
          hitSlop={{ top: 20, right: 20, bottom: 20, left: 20 }}
        >
          <Text style={styles.closeIconText}>✕</Text>
        </TouchableOpacity>

        <FlatList
          ref={flatListRef}
          data={images}
          renderItem={renderItem}
          keyExtractor={(item, index) => index.toString()}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          onMomentumScrollEnd={handleScroll}
          initialScrollIndex={0}
          scrollEnabled={!isClosing}
          getItemLayout={(_, index) => ({
            length: width,
            offset: width * index,
            index,
          })}
        />

        <View style={styles.navigation}>
          <TouchableOpacity
            style={[
              styles.favoriteButton,
              isFavorite && styles.favoriteButtonActive,
            ]}
            onPress={toggleFavorite}
          >
            <Text style={styles.favoriteButtonText}>
              {isFavorite ? "★ Favorite" : "☆ Set as Favorite"}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.95)",
    justifyContent: "center",
    alignItems: "center",
  },
  header: {
    position: "absolute",
    top: 60,
    left: 0,
    right: 0,
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    zIndex: 1001,
  },
  dateText: {
    color: "white",
    fontSize: 16,
    fontWeight: "600",
  },
  counterText: {
    color: "white",
    fontSize: 16,
  },
  closeIcon: {
    position: "absolute",
    top: 50,
    right: 20,
    zIndex: 1002,
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: "rgba(255, 255, 255, 0.3)",
    justifyContent: "center",
    alignItems: "center",
  },
  closeIconText: {
    color: "white",
    fontSize: 16,
    fontWeight: "bold",
  },
  slide: {
    width,
    height: height * 0.6,
    justifyContent: "center",
    alignItems: "center",
  },
  image: {
    width: width * 0.9,
    height: height * 0.6,
    borderRadius: 10,
  },
  navigation: {
    position: "absolute",
    bottom: 40,
    left: 0,
    right: 0,
    flexDirection: "row",
    justifyContent: "center",
    paddingHorizontal: 20,
  },
  navButton: {
    paddingVertical: 10,
    paddingHorizontal: 20,
    backgroundColor: "rgba(255, 255, 255, 0.2)",
    borderRadius: 20,
  },
  navButtonDisabled: {
    opacity: 0.5,
  },
  navButtonText: {
    color: "white",
    fontWeight: "600",
  },
  favoriteButton: {
    paddingVertical: 10,
    paddingHorizontal: 20,
    backgroundColor: "rgba(255, 255, 255, 0.2)",
    borderRadius: 20,
  },
  favoriteButtonActive: {
    backgroundColor: "rgba(255, 215, 0, 0.3)",
    borderWidth: 1,
    borderColor: "rgba(255, 215, 0, 0.7)",
  },
  favoriteButtonText: {
    color: "white",
    fontWeight: "600",
  },
  closeButton: {
    paddingVertical: 10,
    paddingHorizontal: 20,
    backgroundColor: "rgba(255, 255, 255, 0.3)",
    borderRadius: 20,
  },
  closeButtonText: {
    color: "white",
    fontWeight: "600",
  },
  noImagesText: {
    color: "white",
    fontSize: 18,
    marginBottom: 20,
  },
});
