import React from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { useColors } from '@/hooks/useColors'
import { useTranslation, type Language } from '@/i18n'

type LanguageOption = {
  value: Language
  label: string
  accessibilityKey: 'language.turkish' | 'language.english'
}

const languageOptions: LanguageOption[] = [
  { value: 'tr', label: 'TR', accessibilityKey: 'language.turkish' },
  { value: 'en', label: 'EN', accessibilityKey: 'language.english' },
]

export function LanguageToggle() {
  const colors = useColors()
  const { language, setLanguage, t } = useTranslation()

  return (
    <View
      testID="language-toggle"
      accessibilityLabel={t('language.selector')}
      style={[styles.container, { backgroundColor: colors.muted, borderColor: colors.border }]}
    >
      {languageOptions.map((option, index) => {
        const selected = language === option.value
        return (
          <React.Fragment key={option.value}>
            {index > 0 ? <Text style={[styles.separator, { color: colors.mutedForeground }]}>/</Text> : null}
            <Pressable
              testID={`language-toggle-${option.value}`}
              accessibilityRole="button"
              accessibilityLabel={t(option.accessibilityKey)}
              accessibilityState={{ selected }}
              hitSlop={8}
              onPress={() => setLanguage(option.value)}
              style={({ pressed }) => [
                styles.option,
                selected && { backgroundColor: colors.primary },
                pressed && styles.pressed,
              ]}
            >
              <Text style={[styles.label, { color: selected ? colors.primaryForeground : colors.foreground }]}>
                {option.label}
              </Text>
            </Pressable>
          </React.Fragment>
        )
      })}
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    minHeight: 50,
    borderRadius: 12,
    borderWidth: 1,
    padding: 3,
    flexDirection: 'row',
    alignItems: 'center',
  },
  option: {
    minWidth: 44,
    minHeight: 44,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 7,
  },
  separator: {
    fontSize: 12,
    fontWeight: '700',
    paddingHorizontal: 3,
  },
  label: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.4,
  },
  pressed: {
    opacity: 0.7,
  },
})
