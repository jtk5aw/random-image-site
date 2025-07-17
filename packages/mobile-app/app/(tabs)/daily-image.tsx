import React, { useState, useEffect, useMemo } from "react";
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  TouchableOpacity,
} from "react-native";
import { useQuery } from "@tanstack/react-query";
import axios from "axios";

import { TODAYS_IMAGE_ENDPOINT, TODAYS_METADATA_ENDPOINT } from "@/config/api";
import { getUuid, setUuid } from "@/utils/storage";
import { ReactionType } from "@/constants/reactions";
import DailyImage from "@/components/DailyImage/Image";
import Selector from "@/components/Reactions/Selector";
import Swiper from "@/components/Swiper/Swiper";
import { useReactions } from "@/hooks/useReactions";

interface RecentImage {
  url: string;
  date: string;
}

export default function DailyImageScreen() {
  const [currUuid, setCurrUuid] = useState<string | null>(null);
  const [showRecentImages, setShowRecentImages] = useState(false);

  // Use the centralized reactions hook
  const {
    reaction,
    counts,
    favoriteUrl,
    toggleReaction,
    updateFavoriteUrl,
    isFavoriteLoading,
    initializeFromResponse,
  } = useReactions(currUuid);

  // Fetch the current image
  const todaysImageResponse = useQuery({
    queryKey: ["imageUrl"],
    queryFn: () =>
      axios.get(TODAYS_IMAGE_ENDPOINT).then((res) => {
        return res.data;
      }),
  });

  // Fetch todays metadata
  const todaysMetadataResponse = useQuery({
    queryKey: ["metadata", currUuid],
    retry: false,
    enabled: currUuid !== null,
    queryFn: () =>
      axios
        .get(TODAYS_METADATA_ENDPOINT, {
          params: {
            uuid: currUuid,
          },
        })
        .then((res) => {
          return res.data;
        }),
  });

  // Format weekly recap data for the swiper
  const recentImages = useMemo(() => {
    if (!todaysImageResponse.data?.weekly_recap) return [];

    // Create an array of objects with url and date properties
    return Object.entries(todaysImageResponse.data.weekly_recap).map(
      ([date, url]) => ({
        url: url as string,
        date,
      }),
    );
  }, [todaysImageResponse.data?.weekly_recap]);

  // Handle UUID from storage
  useEffect(() => {
    const loadUuid = async () => {
      const storedUuid = await getUuid();
      if (storedUuid) {
        setCurrUuid(storedUuid);
      }
    };
    loadUuid();
  }, []);

  // Set UUID from metadata response if we don't have one
  useEffect(() => {
    if (todaysMetadataResponse.isSuccess && !currUuid) {
      const newUuid = todaysMetadataResponse.data.uuid;
      setUuid(newUuid);
      setCurrUuid(newUuid);
    }
  }, [todaysMetadataResponse, currUuid]);

  // Initialize reaction state from metadata response
  useEffect(() => {
    if (todaysMetadataResponse.isSuccess) {
      initializeFromResponse(todaysMetadataResponse.data);
    }
  }, [todaysMetadataResponse, initializeFromResponse]);

  // Handle reaction selection
  const onEmojiClick = (newReaction: ReactionType) => {
    if (!currUuid) return;
    toggleReaction(newReaction);
  };

  // Toggle recent images view
  const toggleRecentImages = () => {
    setShowRecentImages(!showRecentImages);
  };

  const isLoading =
    todaysImageResponse.isLoading || todaysMetadataResponse.isLoading;
  const imageUrl = todaysImageResponse.data?.url;
  const hasWeeklyRecap = recentImages.length > 0;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>ForMaeov</Text>
        <Text style={styles.heart}>❤️</Text>
      </View>

      {isLoading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#ffffff" />
        </View>
      ) : (
        <View style={styles.content}>
          {imageUrl && (
            <>
              <DailyImage url={imageUrl} alt="today's pic" />
              {hasWeeklyRecap && (
                <TouchableOpacity
                  style={styles.recentButton}
                  onPress={toggleRecentImages}
                  activeOpacity={1.0}
                >
                  <Text style={styles.recentButtonText}>Recent Images</Text>
                </TouchableOpacity>
              )}
              <Selector
                currReaction={reaction}
                onSelect={onEmojiClick}
                counts={counts}
              />
            </>
          )}
        </View>
      )}

      {showRecentImages && hasWeeklyRecap && (
        <Swiper
          images={recentImages}
          onClose={toggleRecentImages}
          currentFavoriteUrl={favoriteUrl}
          isFavoriteLoading={isFavoriteLoading}
          onFavoriteChange={(newFavorite) => {
            // Directly update the favorite URL in the parent component
            // This ensures the state is updated immediately without waiting for a reload
            updateFavoriteUrl(newFavorite);
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#1a1a1a", // bg-noise-dark equivalent
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingTop: 60,
    paddingBottom: 20,
  },
  title: {
    fontSize: 32,
    color: "white",
    fontFamily: "serif", // Will need to be adjusted based on available fonts
  },
  heart: {
    fontSize: 40,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  content: {
    flex: 1,
    alignItems: "center",
    paddingHorizontal: 16,
  },
  recentButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: "rgba(255, 255, 255, 0.1)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.3)",
    marginVertical: 16,
  },
  recentButtonText: {
    color: "rgba(255, 255, 255, 0.7)",
    fontSize: 14,
    fontWeight: "500",
  },
});
