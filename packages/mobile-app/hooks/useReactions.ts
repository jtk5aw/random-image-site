import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import axios from "axios";
import { NO_REACTION, ReactionType } from "@/constants/reactions";
import { TODAYS_METADATA_ENDPOINT, SET_FAVORITE_ENDPOINT } from "@/config/api";

interface ReactionResponse {
  reaction: ReactionType;
  counts: { [key: string]: number };
  uuid: string;
  favorite_image?: string;
}

export function useReactions(uuid: string | null) {
  const queryClient = useQueryClient();
  const [reaction, setReaction] = useState<ReactionType>(
    NO_REACTION as ReactionType,
  );
  const [counts, setCounts] = useState<{ [key: string]: number } | null>(null);
  const [favoriteUrl, setFavoriteUrl] = useState<string>("");

  // Initialize from query data if available
  const initializeFromResponse = (data: ReactionResponse) => {
    // Only set the reaction from the server if we don't have a local reaction yet
    // (i.e., when first loading the component)
    if (reaction === (NO_REACTION as ReactionType)) {
      setReaction(data.reaction as ReactionType);
    }
    setCounts(data.counts);
    if (data.favorite_image) {
      setFavoriteUrl(data.favorite_image);
    }
  };

  // Mutation for updating reactions
  const reactionMutation = useMutation({
    mutationFn: (newReaction: ReactionType) => {
      if (!uuid) throw new Error("UUID is required");

      return axios.put<ReactionResponse>(TODAYS_METADATA_ENDPOINT, {
        reaction: newReaction,
        uuid,
      });
    },
    onMutate: async (newReaction) => {
      // Cancel any outgoing refetches
      await queryClient.cancelQueries({ queryKey: ["metadata", uuid] });

      // Snapshot the previous value
      const previousData = queryClient.getQueryData<ReactionResponse>([
        "metadata",
        uuid,
      ]);

      // Optimistically update to the new value
      if (previousData) {
        queryClient.setQueryData(["metadata", uuid], {
          ...previousData,
          reaction: newReaction,
        });
      }

      // Optimistically update local state
      setReaction(newReaction);

      return { previousData };
    },
    onSuccess: (response) => {
      // Update with the actual server response
      console.log("Updating reaction: ", response.data);
      const data = response.data;
      setCounts(data.counts);

      // Update the query cache but preserve our local reaction state
      queryClient.setQueryData(["metadata", uuid], {
        ...data,
        reaction: reaction, // Keep our local reaction state instead of server's
      });
    },
    onError: (_, __, context) => {
      // Revert to previous state on error
      if (context?.previousData) {
        queryClient.setQueryData(["metadata", uuid], context.previousData);
        setReaction(context.previousData.reaction as ReactionType);
      }
    },
    onSettled: () => {
      // We don't want to refetch here as it could override our local reaction state
      // Only invalidate to get updated counts, but don't refetch automatically
      queryClient.invalidateQueries({
        queryKey: ["metadata", uuid],
        refetchType: "none", // Don't trigger an automatic refetch
      });
    },
  });

  // Mutation for updating favorite image
  const favoriteMutation = useMutation({
    mutationFn: (newFavoriteUrl: string) => {
      if (!uuid) throw new Error("UUID is required");

      console.log("Sending API request to update favorite:", newFavoriteUrl);
      return axios.put<ReactionResponse>(SET_FAVORITE_ENDPOINT, {
        favorite_image: newFavoriteUrl,
        uuid,
      });
    },
    onMutate: async (newFavoriteUrl) => {
      // Cancel any outgoing refetches
      await queryClient.cancelQueries({ queryKey: ["metadata", uuid] });

      // Snapshot the previous value
      const previousData = queryClient.getQueryData<ReactionResponse>([
        "metadata",
        uuid,
      ]);

      // Optimistically update to the new value
      if (previousData) {
        queryClient.setQueryData(["metadata", uuid], {
          ...previousData,
          favorite_image: newFavoriteUrl,
        });
      }

      // Optimistically update local state
      setFavoriteUrl(newFavoriteUrl);

      return { previousData };
    },
    onSuccess: (response) => {
      console.log("Favorite update successful:", response.data);
      // Update with the actual server response
      const data = response.data;
      
      // Get the current query data to extract existing counts
      const currentData = queryClient.getQueryData<ReactionResponse>(["metadata", uuid]);
      const existingCounts = currentData?.counts || counts;
      
      console.log("Preserving existing counts:", existingCounts);
      
      // Update the query cache but preserve our local favorite state and existing counts
      queryClient.setQueryData(["metadata", uuid], {
        ...data,
        favorite_image: favoriteUrl, // Keep our local favorite state
        counts: existingCounts, // Preserve existing counts
      });
    },
    onError: (error, __, context) => {
      console.error("Error updating favorite:", error);
      // Revert to previous state on error
      if (context?.previousData) {
        queryClient.setQueryData(["metadata", uuid], context.previousData);
        setFavoriteUrl(context.previousData.favorite_image || "");
      }
    },
    onSettled: () => {
      // We don't want to refetch here as it could override our local favorite state
      // Only invalidate to get updated data, but don't refetch automatically
      queryClient.invalidateQueries({
        queryKey: ["metadata", uuid],
        refetchType: "none", // Don't trigger an automatic refetch
      });
    },
  });

  // Toggle reaction function
  const toggleReaction = (newReaction: ReactionType) => {
    const finalReaction =
      reaction === newReaction ? (NO_REACTION as ReactionType) : newReaction;
    reactionMutation.mutate(finalReaction);
  };

  // Function to directly update favorite URL
  const updateFavoriteUrl = (newFavoriteUrl: string) => {
    console.log(
      "useReactions: Updating favorite URL from",
      favoriteUrl,
      "to",
      newFavoriteUrl,
    );
    favoriteMutation.mutate(newFavoriteUrl);
  };

  return {
    reaction,
    counts,
    favoriteUrl,
    toggleReaction,
    updateFavoriteUrl,
    isLoading: reactionMutation.isPending,
    isFavoriteLoading: favoriteMutation.isPending,
    initializeFromResponse,
    hasReacted: reaction !== NO_REACTION,
    hasFavorite: favoriteUrl !== "",
  };
}
