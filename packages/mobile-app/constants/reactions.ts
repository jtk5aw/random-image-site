export type ReactionType = 'Love' | 'Tough' | 'Funny' | 'Wow' | 'NoReaction';

export const NO_REACTION = 'NoReaction';

export const REACTIONS: Record<string, { emoji: string, label: string }> = {
  'Love': { emoji: '😍', label: 'Love' },
  'Tough': { emoji: '😤', label: 'Tough' },
  'Funny': { emoji: '😂', label: 'Funny' },
  'Wow': { emoji: '🤩', label: 'Wow' }
};