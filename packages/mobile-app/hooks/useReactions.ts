import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import axios from 'axios';
import { NO_REACTION, ReactionType } from '@/constants/reactions';
import { TODAYS_METADATA_ENDPOINT } from '@/config/api';

interface ReactionResponse {
  reaction: ReactionType;
  counts: { [key: string]: number };
  uuid: string;
  favorite_image?: string;
}

export function useReactions(uuid: string | null) {
  const queryClient = useQueryClient();
  const [reaction, setReaction] = useState<ReactionType>(NO_REACTION as ReactionType);
  const [counts, setCounts] = useState<{ [key: string]: number } | null>(null);
  const [favoriteUrl, setFavoriteUrl] = useState<string>('');

  // Initialize from query data if available
  const initializeFromResponse = (data: ReactionResponse) => {
    setReaction(data.reaction as ReactionType);
    setCounts(data.counts);
    if (data.favorite_image) {
      setFavoriteUrl(data.favorite_image);
    }
  };

  // Mutation for updating reactions
  const reactionMutation = useMutation({
    mutationFn: (newReaction: ReactionType) => {
      if (!uuid) throw new Error('UUID is required');
      
      return axios.put<ReactionResponse>(TODAYS_METADATA_ENDPOINT, {
        reaction: newReaction,
        uuid,
      });
    },
    onMutate: async (newReaction) => {
      // Cancel any outgoing refetches
      await queryClient.cancelQueries({ queryKey: ['metadata', uuid] });
      
      // Snapshot the previous value
      const previousData = queryClient.getQueryData<ReactionResponse>(['metadata', uuid]);
      
      // Optimistically update to the new value
      if (previousData) {
        queryClient.setQueryData(['metadata', uuid], {
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
      const data = response.data;
      setCounts(data.counts);
      
      // Update the query cache
      queryClient.setQueryData(['metadata', uuid], data);
    },
    onError: (_, __, context) => {
      // Revert to previous state on error
      if (context?.previousData) {
        queryClient.setQueryData(['metadata', uuid], context.previousData);
        setReaction(context.previousData.reaction as ReactionType);
      }
    },
    onSettled: () => {
      // Refetch to ensure we have the latest data
      queryClient.invalidateQueries({ queryKey: ['metadata', uuid] });
    },
  });

  // Toggle reaction function
  const toggleReaction = (newReaction: ReactionType) => {
    const finalReaction = reaction === newReaction ? NO_REACTION as ReactionType : newReaction;
    reactionMutation.mutate(finalReaction);
  };

  // Function to directly update favorite URL
  const updateFavoriteUrl = (newFavoriteUrl: string) => {
    console.log('useReactions: Updating favorite URL from', favoriteUrl, 'to', newFavoriteUrl);
    setFavoriteUrl(newFavoriteUrl);
    
    // Update the query cache with the new favorite
    const currentData = queryClient.getQueryData<ReactionResponse>(['metadata', uuid]);
    if (currentData) {
      console.log('useReactions: Updating query cache with new favorite');
      queryClient.setQueryData(['metadata', uuid], {
        ...currentData,
        favorite_image: newFavoriteUrl
      });
    } else {
      console.log('useReactions: No current data in query cache to update');
    }
  };

  return {
    reaction,
    counts,
    favoriteUrl,
    toggleReaction,
    updateFavoriteUrl,
    isLoading: reactionMutation.isPending,
    initializeFromResponse,
    hasReacted: reaction !== NO_REACTION,
    hasFavorite: favoriteUrl !== '',
  };
}