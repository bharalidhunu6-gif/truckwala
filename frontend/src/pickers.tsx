import React, { forwardRef, useCallback, useImperativeHandle, useState } from "react";
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  Modal,
  FlatList,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors, spacing, type, radius } from "./theme";

export type PickerItem = {
  value: string;
  label: string;
  icon?: any;
};

type PickerRef = {
  expand: () => void;
  close: () => void;
};

export function usePicker() {
  const ref = React.useRef<PickerRef | null>(null);

  const open = useCallback(() => {
    ref.current?.expand();
  }, []);

  const close = useCallback(() => {
    ref.current?.close();
  }, []);

  return { ref, open, close };
}

export const BottomPicker = forwardRef<PickerRef, {
  sheetRef: React.RefObject<PickerRef | null>;
  title: string;
  items: PickerItem[];
  value?: string | null;
  onChange: (v: string) => void;
  testID?: string;
}>(
  function BottomPicker(
    {
      sheetRef,
      title,
      items,
      value,
      onChange,
      testID,
    },
    forwardedRef
  ) {
    const [visible, setVisible] = useState(false);

    const close = useCallback(() => {
      setVisible(false);
    }, []);

    const expand = useCallback(() => {
      setVisible(true);
    }, []);

    useImperativeHandle(
      sheetRef,
      () => ({
        expand,
        close,
      }),
      [expand, close]
    );

    useImperativeHandle(
      forwardedRef,
      () => ({
        expand,
        close,
      }),
      [expand, close]
    );

    return (
      <Modal
        visible={visible}
        transparent
        animationType="slide"
        onRequestClose={close}
      >
        <View style={styles.overlay}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={close}
          />

          <View style={styles.sheet} testID={testID}>
            <View style={styles.handle} />

            <Text style={styles.title}>{title}</Text>

            <FlatList
              data={items}
              keyExtractor={(item) => item.value}
              showsVerticalScrollIndicator={true}
              contentContainerStyle={styles.list}
              renderItem={({ item }) => {
                const active = item.value === value;

                return (
                  <Pressable
                    testID={`picker-item-${item.value}`}
                    onPress={() => {
                      onChange(item.value);
                      close();
                    }}
                    style={({ pressed }) => [
                      styles.row,
                      active && styles.activeRow,
                      pressed && { opacity: 0.7 },
                    ]}
                  >
                    <View style={styles.left}>
                      {item.icon ? (
                        <Ionicons
                          name={item.icon}
                          size={20}
                          color={
                            active
                              ? colors.brand
                              : colors.onSurfaceMuted
                          }
                        />
                      ) : null}

                      <Text
                        style={[
                          type.body,
                          {
                            color: active
                              ? colors.brand
                              : colors.onSurface,
                            fontWeight: active ? "700" : "500",
                          },
                        ]}
                      >
                        {item.label}
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
              }}
            />
          </View>
        </View>
      </Modal>
    );
  }
);

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "flex-end",
  },

  sheet: {
    maxHeight: "88%",
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.xxl,
  },

  handle: {
    width: 44,
    height: 5,
    borderRadius: 3,
    backgroundColor: colors.borderStrong,
    alignSelf: "center",
    marginBottom: spacing.lg,
  },

  title: {
    ...type.h2,
    marginBottom: spacing.md,
  },

  list: {
    paddingBottom: spacing.xxl,
  },

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

  activeRow: {
    backgroundColor: colors.brandLight,
    borderColor: colors.brand,
  },

  left: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    flex: 1,
  },
});