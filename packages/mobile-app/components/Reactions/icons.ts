import { REACTIONS } from '@/constants/reactions';

export const reactionIcons: { [key: string]: string } = Object.entries(REACTIONS).reduce(
  (acc, [key, { emoji }]) => ({ ...acc, [key]: emoji }), 
  {}
);