import { NO_REACTION, ReactionType } from '@/constants/reactions';

export const hasReacted = (reaction: ReactionType): boolean => {
  return reaction !== NO_REACTION;
};