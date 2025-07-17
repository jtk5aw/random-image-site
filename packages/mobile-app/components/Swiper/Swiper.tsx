import React, { useState, useEffect, useRef } from "react";
import {
  View,
  StyleSheet,
  Image,
  Dimensions,
  Text,
  TouchableOpacity,
  FlatList,
  Modal,
  BackHandler,
  ActivityIndicator,
} from "react-native";
import { format } from "date-fns";
import { getUuid } from "@/utils/storage";
import {
  GestureHandlerRootView,
  TapGestureHandler,
  State,
} from "react-native-gesture-handler";

interface SwiperProps {
  images: Array<{
    url: string;
    date: string;
  }>;
  onClose: () => void;
  currentFavoriteUrl?: string;
  isFavoriteLoading?: boolean;
  onFavoriteChange?: (newFavorite: string) => void;
}

const { width, height } = Dimensions.get("window");

export default function Swiper({
  images,
  onClose,
  currentFavoriteUrl = "",
  isFavoriteLoading = false,
  onFavoriteChange,
}: SwiperProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [uuid, setUuid] = useState<string | null>(null);
  const [isClosing, setIsClosing] = useState(false);
  const [modalVisible, setModalVisible] = useState(true);
  const [showFavoriteToast, setShowFavoriteToast] = useState(false);

  const flatListRef = useRef<FlatList>(null);
  const doubleTapRef = useRef(null);
  const singleTapRef = useRef(null);

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

    const newImage = images[currentIndex];
    const newFavoriteUrl =
      newImage.url === currentFavoriteUrl ? "" : newImage.url;

    console.log("Toggling favorite:", {
      newImageUrl: newImage.url,
      oldFavoriteUrl: currentFavoriteUrl,
      newFavoriteUrl,
      action: newImage.url === currentFavoriteUrl ? "removing" : "setting",
    });

    // Call parent components update function
    if (onFavoriteChange) {
      onFavoriteChange(newFavoriteUrl);
    }
  };

  // Handle single tap (close the modal)
  const onSingleTap = (event: any) => {
    if (event.nativeEvent.state === State.ACTIVE) {
      handleClose();
    }
  };

  // Handle double tap (set as favorite)
  const onDoubleTap = (event: any) => {
    if (event.nativeEvent.state === State.ACTIVE && !isFavoriteLoading) {
      // Show a brief visual feedback for double tap
      setShowFavoriteToast(true);
      setTimeout(() => {
        setShowFavoriteToast(false);
      }, 2000);

      toggleFavorite();
    }
  };

  const currentImage = images[currentIndex];
  // Calculate isFavorite based on current image and favoriteUrl
  const [isFavorite, setIsFavorite] = useState(
    currentImage?.url === currentFavoriteUrl,
  );

  // Update isFavorite only when currentIndex changes
  useEffect(() => {
    if (images.length > 0) {
      // Only check if the current image is the favorite, don't set a new favorite
      const isCurrentImageFavorite =
        images[currentIndex].url === currentFavoriteUrl;
      setIsFavorite(isCurrentImageFavorite);
    }
  }, [currentIndex, currentFavoriteUrl, images]);

  if (images.length === 0) {
    return (
      <Modal
        animationType="fade"
        transparent={true}
        visible={modalVisible}
        onRequestClose={handleClose}
      >
        <GestureHandlerRootView style={{ flex: 1 }}>
          <View style={styles.container}>
            <Text style={styles.noImagesText}>No recent images available</Text>
            <TouchableOpacity style={styles.closeButton} onPress={handleClose}>
              <Text style={styles.closeButtonText}>Close</Text>
            </TouchableOpacity>
          </View>
        </GestureHandlerRootView>
      </Modal>
    );
  }

  const renderItem = ({ item }: { item: { url: string; date: string } }) => (
    <View style={styles.slide}>
      <Image
        source={{ uri: item.url }}
        style={styles.image}
        resizeMode="contain"
      />
    </View>
  );

  return (
    <Modal
      animationType="fade"
      transparent={true}
      visible={modalVisible}
      onRequestClose={handleClose}
    >
      <GestureHandlerRootView style={{ flex: 1 }}>
        <View style={styles.container}>
          <View style={styles.header}>
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

          <TapGestureHandler
            ref={singleTapRef}
            onHandlerStateChange={onSingleTap}
            waitFor={doubleTapRef}
          >
            <View style={styles.gestureContainer}>
              <TapGestureHandler
                ref={doubleTapRef}
                onHandlerStateChange={onDoubleTap}
                numberOfTaps={2}
              >
                <View style={styles.gestureContainer}>
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
                </View>
              </TapGestureHandler>
            </View>
          </TapGestureHandler>

          <View style={styles.navigation}>
            <TouchableOpacity
              style={[
                styles.favoriteButton,
                isFavorite && styles.favoriteButtonActive,
                isFavoriteLoading && styles.favoriteButtonLoading,
              ]}
              onPress={toggleFavorite}
              disabled={isFavoriteLoading}
            >
              {isFavoriteLoading ? (
                <View style={styles.loadingContainer}>
                  <ActivityIndicator size="small" color="#ffffff" />
                  <Text style={[styles.favoriteButtonText, styles.loadingText]}>
                    {isFavorite ? "Updating..." : "Undoing..."}
                  </Text>
                </View>
              ) : (
                <Text style={styles.favoriteButtonText}>
                  {isFavorite ? "★ Favorite" : "☆ Set as Favorite"}
                </Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </GestureHandlerRootView>
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
  gestureContainer: {
    flex: 1,
    width: width,
    justifyContent: "center",
    alignItems: "center",
  },
  header: {
    position: "absolute",
    top: 60,
    left: 0,
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
    fontWeight: "600",
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
    height: height * 0.7, // Increased height for better vertical centering
    justifyContent: "center",
    alignItems: "center",
    marginTop: 20, // Add some margin to push it down slightly
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
  favoriteButtonLoading: {
    opacity: 0.7,
  },
  favoriteButtonText: {
    color: "white",
    fontWeight: "600",
  },
  loadingContainer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  loadingText: {
    marginLeft: 8,
  },
  favoriteToast: {
    position: "absolute",
    padding: 10,
    backgroundColor: "rgba(255, 215, 0, 0.7)",
    borderRadius: 20,
    alignSelf: "center",
    top: height / 2 - 50,
    opacity: 0.9,
  },
  favoriteToastText: {
    color: "white",
    fontWeight: "bold",
    fontSize: 16,
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
