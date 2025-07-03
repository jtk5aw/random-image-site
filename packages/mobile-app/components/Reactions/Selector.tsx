import React from 'react';
import { View, StyleSheet } from 'react-native';
import SelectorEmoji from './SelectorEmoji';
import { ReactionType, REACTIONS } from '@/constants/reactions';

interface SelectorProps {
  reactions?: ReactionType[];
  currReaction: ReactionType;
  onSelect: (reaction: ReactionType) => void;
  counts?: { [key: string]: number } | null;
}

export default function Selector({ 
  reactions = Object.keys(REACTIONS) as ReactionType[], 
  currReaction, 
  onSelect,
  counts = null
}: SelectorProps) {
  return (
    <View style={styles.container}>
      {reactions.map((reaction) => (
        <SelectorEmoji
          key={reaction}
          selected={reaction === currReaction}
          label={reaction}
          onSelect={onSelect}
          count={counts?.[reaction] || 0}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 20,
    flexWrap: 'wrap',
  },
});