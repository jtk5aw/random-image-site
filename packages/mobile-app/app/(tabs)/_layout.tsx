import { Tabs } from "expo-router";
import React from "react";
import { Platform } from "react-native";

import { HapticTab } from "@/components/HapticTab";
import { IconSymbol } from "@/components/ui/IconSymbol";
import TabBarBackground from "@/components/ui/TabBarBackground";
import { Colors } from "@/constants/Colors";
import { useColorScheme } from "@/hooks/useColorScheme";
import Entypo from "@expo/vector-icons/Entypo";

export default function TabLayout() {
  const colorScheme = useColorScheme();

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: Colors[colorScheme ?? "light"].tint,
        headerShown: false,
        tabBarButton: HapticTab,
        tabBarBackground: TabBarBackground,
        tabBarStyle: Platform.select({
          ios: {
            // Use a transparent background on iOS to show the blur effect
            position: "absolute",
          },
          default: {},
        }),
      }}
    >
      <Tabs.Screen
        name="daily-image"
        options={{
          title: "Daily Image",
          tabBarIcon: ({ color }) => (
            <IconSymbol size={28} name="photo.fill" color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="apple"
        options={{
          title: "Apple Auth",
          tabBarIcon: ({ color }) => (
            <Entypo name="login" size={28} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}
