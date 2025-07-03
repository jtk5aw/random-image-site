import React from "react";
import { TouchableOpacity, Text, StyleSheet, View } from "react-native";
import { reactionIcons } from "./icons";
import { ReactionType } from "@/constants/reactions";

interface SelectorEmojiProps {
  selected: boolean;
  label: ReactionType;
  onSelect: (reaction: ReactionType) => void;
  count?: number;
}

export default function SelectorEmoji({
  selected,
  label,
  onSelect,
  count = 0,
}: SelectorEmojiProps) {
  const handlePress = () => {
    onSelect(label);
  };

  return (
    <TouchableOpacity
      style={[styles.container, selected && styles.selected]}
      onPress={handlePress}
      activeOpacity={0.7}
    >
      <Text style={styles.emoji}>{reactionIcons[label] || "❓"}</Text>
      {count > 0 && (
        <View style={styles.countBadge}>
          <Text style={styles.countText}>{count}</Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 12,
    margin: 8,
    borderRadius: 25,
    backgroundColor: "rgba(255, 255, 255, 0.1)",
    minWidth: 50,
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
  },
  selected: {
    backgroundColor: "rgba(255, 255, 255, 0.3)",
    borderWidth: 2,
    borderColor: "white",
  },
  emoji: {
    fontSize: 24,
  },
  countBadge: {
    position: "absolute",
    top: 0,
    right: 0,
    backgroundColor: "rgba(255, 255, 255, 0.8)",
    borderRadius: 10,
    minWidth: 20,
    height: 20,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 4,
  },
  countText: {
    color: "#1a1a1a",
    fontSize: 12,
    fontWeight: "bold",
  },
});
