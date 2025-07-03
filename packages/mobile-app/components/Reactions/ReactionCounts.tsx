import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { reactionIcons } from './icons';
import { ReactionType } from '@/constants/reactions';

interface ReactionCountsProps {
  counts: { [key: string]: number } | null;
  onToggleRecentImagesClick?: (() => void) | null;
  hasFavorite: boolean;
}

export default function ReactionCounts({ 
  counts, 
  onToggleRecentImagesClick, 
  hasFavorite 
}: ReactionCountsProps) {
  if (!counts) {
    return null;
  }

  const reactionEntries = Object.entries(counts)
    .filter(([_, count]) => count > 0)
    .sort(([, a], [, b]) => b - a);

  return (
    <View style={styles.container}>
      <View style={styles.countsContainer}>
        {reactionEntries.map(([reaction, count]) => (
          <View key={reaction} style={styles.reactionItem}>
            <Text style={styles.emoji}>
              {reactionIcons[reaction] || '❓'}
            </Text>
            <Text style={styles.count}>{count}</Text>
          </View>
        ))}
      </View>
      
      {onToggleRecentImagesClick && (
        <TouchableOpacity 
          style={[styles.recentButton, hasFavorite && styles.recentButtonActive]}
          onPress={onToggleRecentImagesClick}
          activeOpacity={0.7}
        >
          <Text style={[styles.recentButtonText, hasFavorite && styles.recentButtonTextActive]}>
            Recent Images
          </Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingVertical: 16,
    alignItems: 'center',
  },
  countsContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    flexWrap: 'wrap',
    marginBottom: 12,
  },
  reactionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 8,
    marginVertical: 4,
  },
  emoji: {
    fontSize: 20,
    marginRight: 4,
  },
  count: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },
  recentButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.3)',
  },
  recentButtonActive: {
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    borderColor: 'white',
  },
  recentButtonText: {
    color: 'rgba(255, 255, 255, 0.7)',
    fontSize: 14,
    fontWeight: '500',
  },
  recentButtonTextActive: {
    color: 'white',
  },
});