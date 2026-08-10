import React, { useCallback, useMemo, useRef } from "react";
import BottomSheet, {
  BottomSheetView,
  BottomSheetBackdrop,
  BottomSheetScrollView,
} from "@gorhom/bottom-sheet";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors, spacing, type, radius } from "./theme";

export type PickerItem = {
  value: string;
  label: string;
  icon?: any;
};

export function usePicker() {
  const ref = useRef<BottomSheet>(null);

  const open = useCallback(() => {
    ref.current?.expand();
  }, []);

  const close = useCallback(() => {
    ref.current?.close();
  }, []);

  return { ref, open, close };
}

export function BottomPicker({
  sheetRef,
  title,
  items,
  value,
  onChange,
  testID,
}: {
  sheetRef: React.RefObject<BottomSheet | null>;
  title: string;
  items: PickerItem[];
  value?: string | null;
  onChange: (v: string) => void;
  testID?: string;
}) {
  const snapPoints = useMemo(() => ["88%"], []);

  const renderBackdrop = useCallback(
    (props: any) => (
      <BottomSheetBackdrop
        {...props}
        appearsOnIndex={0}
        disappearsOnIndex={-1}
        opacity={0.5}
        pressBehavior="close"
      />
    ),
    []
  );

  return (
    <BottomSheet
      ref={sheetRef}
      index={-1}
      snapPoints={snapPoints}
      enableHandlePanningGesture={true}
      enablePanDownToClose
      backdropComponent={renderBackdrop}
      handleIndicatorStyle={{
        backgroundColor: colors.borderStrong,
        width: 44,
      }}
      backgroundStyle={{
        backgroundColor: colors.surface,
        borderTopLeftRadius: radius.xl,
        borderTopRightRadius: radius.xl,
      }}
    >
      <BottomSheetView
        style={{
          flex: 1,
          paddingHorizontal: spacing.lg,
        }}
        testID={testID}
      >
        <Text style={[type.h2, { marginBottom: spacing.md }]}>
          {title}
        </Text>

        <BottomSheetScrollView
          showsVerticalScrollIndicator={true}
          contentContainerStyle={{
            paddingBottom: spacing.xxl,
          }}
        
        >
          {items.map((it) => {
            const active = it.value === value;

            return (
              <Pressable
                key={it.value}
                testID={`picker-item-${it.value}`}
                onPress={() => {
                  onChange(it.value);
                  sheetRef.current?.close();
                }}
                style={({ pressed }) => [
                  s.row,
                  active && {
                    backgroundColor: colors.brandLight,
                    borderColor: colors.brand,
                  },
                  pressed && {
                    opacity: 0.75,
                  },
                ]}
              >
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 12,
                    flex: 1,
                  }}
                >
                  {it.icon ? (
                    <Ionicons
                      name={it.icon}
                      size={20}
                      color={
                        active
                          ? colors.brand
                          : colors.onSurfaceMuted
                      }
                    />
                  ) : null}

                  <Text
                    style={{
                      ...type.body,
                      color: active
                        ? colors.brand
                        : colors.onSurface,
                      fontWeight: active ? "700" : "500",
                    }}
                  >
                    {it.label}
                  </Text>
                </View>

                {active ? (
                  <Ionicons
                    name="checkmark-circle"
                    size={22}
                    color={colors.brand}
                  />
                ) : null}
              </Pressable>
            );
          })}
        </BottomSheetScrollView>
      </BottomSheetView>
    </BottomSheet>
  );
}

const s = StyleSheet.create({
  row: {
    paddingHorizontal: spacing.md,
    paddingVertical: 14,
    borderRadius: radius.md,
    marginBottom: 6,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderWidth: 1,
    borderColor: colors.divider,
    backgroundColor: colors.surface,
  },
});