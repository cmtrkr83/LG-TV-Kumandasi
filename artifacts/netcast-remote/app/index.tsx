import * as Haptics from 'expo-haptics'
import * as Network from 'expo-network'
import {
  isAvailable as isSsdpAvailable,
  listenForNotifications,
  searchStream,
  type SsdpDevice,
  type SsdpNotifyEvent,
} from 'expo-ssdp'
import { Feather } from '@expo/vector-icons'
import { useFocusEffect } from 'expo-router'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AccessibilityInfo,
  ActivityIndicator,
  KeyboardAvoidingView,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import colors from '@/constants/colors'
import { LanguageToggle } from '@/components/LanguageToggle'
import {
  remoteTestID,
  useTranslation,
  type MessageDescriptor,
  type MessageParams,
  type TranslationKey,
} from '@/i18n'
import {
  isAbortErrorKind,
  isAuthError,
  isTransientError,
  isUnsupportedError,
  normalizeHost,
  requestPairingKey,
  createSession,
  sendCommand,
  sendTouchClick,
  sendTouchMove,
  sendTouchWheel,
  type Connection,
} from '@/protocol/netcast'
import { getSafeScanHosts, scanLocalSubnet } from '@/protocol/scan'
import { QueueBackpressureError, QueueClosedError, SerialRequestQueue, type QueueKey } from '@/protocol/requestQueue'
import {
  clearPersistedConnection,
  loadPersistedConnection,
  savePersistedConnection,
  StorageError,
} from '@/storage/connectionStorage'

const SSDP_TIMEOUT_MS = 8000

type DiscoveredTv = {
  id: string
  host: string
  name: string
  online: boolean
  model?: string
  server?: string
}

type RemoteCommand = {
  key: number
  labelKey: TranslationKey
  testID: string
  labelParams?: MessageParams
  icon: keyof typeof Feather.glyphMap
  tone?: 'primary' | 'soft' | 'danger'
}

function createRemoteCommand(
  key: number,
  labelKey: TranslationKey,
  icon: keyof typeof Feather.glyphMap,
  tone?: RemoteCommand['tone'],
  labelParams?: MessageParams,
): RemoteCommand {
  return {
    key,
    labelKey,
    labelParams,
    testID: remoteTestID(labelKey, labelParams),
    icon,
    tone,
  }
}

type HoldContext = {
  repeating: boolean
}

type HoldHandler = (
  command: RemoteCommand,
  context?: HoldContext,
) => void | (() => void)

const COMMANDS = {
  POWER: 1,
  NUM_0: 2,
  NUM_1: 3,
  NUM_2: 4,
  NUM_3: 5,
  NUM_4: 6,
  NUM_5: 7,
  NUM_6: 8,
  NUM_7: 9,
  NUM_8: 10,
  NUM_9: 11,
  UP: 12,
  DOWN: 13,
  LEFT: 14,
  RIGHT: 15,
  OK: 20,
  HOME: 21,
  MENU: 22,
  BACK: 23,
  VOLUME_UP: 24,
  VOLUME_DOWN: 25,
  MUTE: 26,
  CHANNEL_UP: 27,
  CHANNEL_DOWN: 28,
  BLUE: 29,
  GREEN: 30,
  RED: 31,
  YELLOW: 32,
  PLAY: 33,
  PAUSE: 34,
  STOP: 35,
  REWIND: 37,
  FAST_FORWARD: 36,
  LIVE_TV: 43,
  GUIDE: 44,
  INFO: 45,
  RATIO: 46,
  INPUT: 47,
  SUBTITLE: 49,
  CHANNEL_LIST: 50,
  DASH: 402,
  PREV_CHANNEL: 403,
  FAVORITE: 404,
  QUICK_MENU: 405,
  EXIT: 412,
  APPS: 417,
} as const

const NETCAST_SEARCH_TARGETS = [
  'ssdp:all',
  'udap:rootservice',
  'urn:schemas-udap:service:netrcu:1',
  'urn:schemas-udap:service:smartText:1',
]

function getSsdpHeader(device: SsdpDevice, ...names: string[]) {
  const headers = device.headers ?? {}
  for (const name of names) {
    const matchingKey = Object.keys(headers).find((key) => key.toLowerCase() === name.toLowerCase())
    if (matchingKey && headers[matchingKey]) return headers[matchingKey]
  }
  return ''
}

function toNetCastTv(device: SsdpDevice): DiscoveredTv | null {
  const model = getSsdpHeader(device, 'modelname', 'model-name', 'model', 'friendlyname', 'device-name')
  const server = device.server ?? getSsdpHeader(device, 'server')
  const responseText = [
    model,
    server,
    device.st,
    device.usn,
    device.location,
    ...Object.values(device.headers ?? {}),
  ]
    .join(' ')
    .toLowerCase()

  if (!/lg|lge|netcast|udap|rootservice|schemas-udap/.test(responseText)) return null

  return {
    id: device.usn?.split('::')[0] || `${device.address}:${device.location ?? ''}`,
    host: device.address,
    name: model || 'LG NetCast TV',
    online: true,
    model: model || undefined,
    server: server || undefined,
  }
}

function upsertDiscoveredTv(previous: DiscoveredTv[], tv: DiscoveredTv) {
  const existingIndex = previous.findIndex((item) => item.id === tv.id || item.host === tv.host)
  if (existingIndex === -1) return [...previous, tv]

  const next = [...previous]
  next[existingIndex] = { ...next[existingIndex], ...tv, online: true }
  return next
}

function notifyDeviceId(event: SsdpNotifyEvent) {
  return event.usn?.split('::')[0] ?? ''
}

function notifyLooksLikeNetCast(event: SsdpNotifyEvent) {
  const eventText = [
    event.usn,
    event.nt,
    event.location,
    ...Object.values(event.headers ?? {}),
  ]
    .join(' ')
    .toLowerCase()
  return /lg|lge|netcast|udap|rootservice|schemas-udap/.test(eventText)
}

function tvMatchesNotification(tv: DiscoveredTv, event: SsdpNotifyEvent) {
  const deviceId = notifyDeviceId(event)
  return tv.host === event.address || (Boolean(deviceId) && tv.id === deviceId)
}

function tvMatchesHost(tv: DiscoveredTv, address: string) {
  return tv.host === address
}

function safeSelectionHaptic() {
  try {
    void Haptics.selectionAsync().catch(() => undefined)
  } catch {
    return
  }
}

function safeImpactHaptic() {
  try {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined)
  } catch {
    return
  }
}

function commandFailureMessage(error: unknown): MessageDescriptor | null {
  if (error instanceof QueueBackpressureError) return { key: 'error.commandQueueFull' }
  if (isUnsupportedError(error)) return { key: 'error.commandUnsupported' }
  if (isTransientError(error)) return { key: 'error.commandTransient' }
  if (isAbortErrorKind(error)) return null
  return { key: 'error.commandFailed' }
}

function storageWarningMessage(warning: StorageError): MessageDescriptor {
  switch (warning.operation) {
    case 'read':
    case 'parse':
    case 'secure-read':
      return { key: 'error.storageRead' }
    case 'remove':
    case 'legacy-remove':
    case 'secure-remove':
      return { key: 'error.storageCleanup' }
    case 'write':
    case 'secure-write':
      return { key: 'error.storageSave' }
  }
}

function storageWarningStatus(warning: StorageError): MessageDescriptor {
  switch (warning.operation) {
    case 'read':
    case 'parse':
    case 'secure-read':
      return { key: 'status.storageReadWarning' }
    case 'remove':
    case 'legacy-remove':
    case 'secure-remove':
      return { key: 'status.storageCleanupWarning' }
    case 'write':
    case 'secure-write':
      return { key: 'status.storageSaveWarning' }
  }
}

function IconButton({
  command,
  onPress,
  disabled,
  iconOnly,
}: {
  command: RemoteCommand;
  onPress: (command: RemoteCommand) => void;
  disabled?: boolean;
  iconOnly?: boolean;
}) {
  const { t } = useTranslation()
  const label = t(command.labelKey, command.labelParams)

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      testID={command.testID}
      disabled={disabled}
      onPress={() => onPress(command)}
      style={({ pressed }) => [
        styles.iconButton,
        command.tone === 'primary' && styles.primaryButton,
        command.tone === 'danger' && styles.dangerButton,
        pressed && styles.pressed,
        disabled && styles.disabled,
      ]}
    >
      <Feather
        name={command.icon}
        size={20}
        color={
          command.tone === 'primary'
            ? colors.primaryForeground
            : command.tone === 'danger'
              ? colors.destructiveForeground
              : colors.foreground
        }
      />
      {iconOnly ? null : (
        <Text
          numberOfLines={2}
          style={[
            styles.buttonLabel,
            command.tone === 'primary' && styles.primaryLabel,
          ]}
        >
          {label}
        </Text>
      )}
    </Pressable>
  )
}

function SectionCaption({ children }: { children: string }) {
  return <Text style={styles.sectionCaption}>{children}</Text>;
}

/**
 * Ergonomics: volume / channel need press-and-hold repeat — tapping 20 times
 * to change volume is the #1 pain of soft remotes. Fires immediately on
 * touch-down, then repeats after a short delay. Uses the repeat path (no
 * global busy lock) so repeats flow without stutter.
 */
const HOLD_INITIAL_DELAY_MS = 450;
const HOLD_REPEAT_MS = 200;

function PressHoldButton({
  command,
  onHold,
  disabled,
  flat,
  seam,
}: {
  command: RemoteCommand;
  onHold: HoldHandler;
  disabled?: boolean;
  /** Bare half inside a joined rocker pill (container provides bg/shape). */
  flat?: boolean;
  /** Divider line under this half (used for the top half of a rocker). */
  seam?: boolean;
}) {
  const { t } = useTranslation()
  const label = t(command.labelKey, command.labelParams)
  const timers = useRef<{ delay?: ReturnType<typeof setTimeout>; repeat?: ReturnType<typeof setInterval> }>({})
  const cancelRef = useRef<(() => void) | null>(null)

  const stop = useCallback(() => {
    if (timers.current.delay !== undefined) clearTimeout(timers.current.delay)
    if (timers.current.repeat !== undefined) clearInterval(timers.current.repeat)
    timers.current = {}
    const cancel = cancelRef.current
    cancelRef.current = null
    cancel?.()
  }, [])

  useEffect(() => {
    if (disabled) stop()
    return stop
  }, [disabled, stop])

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={t('a11y.holdRepeatHint')}
      testID={command.testID}
      disabled={disabled}
      onPressIn={() => {
        if (disabled) return
        stop()
        safeSelectionHaptic()
        const cancel = onHold(command, { repeating: false })
        cancelRef.current = typeof cancel === 'function' ? cancel : null
        timers.current.delay = setTimeout(() => {
          timers.current.repeat = setInterval(() => {
            const cancel = onHold(command, { repeating: true })
            if (typeof cancel === 'function') cancelRef.current = cancel
          }, HOLD_REPEAT_MS)
        }, HOLD_INITIAL_DELAY_MS)
      }}
      onPressOut={stop}
      onBlur={stop}
      style={({ pressed }) => [
        styles.iconButton,
        flat && styles.rockerHalf,
        seam && styles.rockerSeam,
        pressed && styles.pressed,
        disabled && styles.disabled,
      ]}
    >
      <Feather name={command.icon} size={22} color={colors.foreground} />
      <Text numberOfLines={2} style={styles.buttonLabel}>
        {label}
      </Text>
    </Pressable>
  );
}

function NumberKey({
  digit,
  onPress,
  disabled,
}: {
  digit: string;
  onPress: (digit: string) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation()
  const label = t('command.digit', { digit })

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      testID={remoteTestID('command.digit', { digit })}
      disabled={disabled}
      onPress={() => onPress(digit)}
      style={({ pressed }) => [
        styles.numberKey,
        pressed && styles.pressed,
        disabled && styles.disabled,
      ]}
    >
      <Text style={styles.numberKeyText}>{digit}</Text>
    </Pressable>
  );
}

/**
 * Touchpad page (left page). Drag moves the TV cursor (relative deltas,
 * scaled by MOUSE_SENSITIVITY); a quick tap without drag sends a click.
 * Calls onActiveChange so the outer horizontal pager can lock while the
 * finger is down — otherwise the pager would steal horizontal drags.
 */
const MOUSE_SENSITIVITY = 2;
const MOUSE_MAX_STEP = 60;
const TAP_MAX_DIST = 12;
const TAP_MAX_MS = 300;

function TouchPad({
  onMove,
  onTap,
  onActiveChange,
  disabled,
}: {
  onMove: (dx: number, dy: number) => void;
  onTap: () => void;
  onActiveChange: (active: boolean) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation()
  const [touching, setTouching] = useState(false)
  const gesture = useRef({ lastX: 0, lastY: 0, startT: 0 })
  const disabledRef = useRef(disabled)
  const onMoveRef = useRef(onMove)
  const onTapRef = useRef(onTap)
  const onActiveChangeRef = useRef(onActiveChange)
  disabledRef.current = disabled
  onMoveRef.current = onMove
  onTapRef.current = onTap
  onActiveChangeRef.current = onActiveChange

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => !disabledRef.current,
      onMoveShouldSetPanResponder: () => !disabledRef.current,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => {
        if (disabledRef.current) return
        gesture.current = { lastX: 0, lastY: 0, startT: Date.now() }
        setTouching(true)
        onActiveChangeRef.current(true)
      },
      onPanResponderMove: (_, gestureState) => {
        if (disabledRef.current) return
        const rawDx = (gestureState.dx - gesture.current.lastX) * MOUSE_SENSITIVITY
        const rawDy = (gestureState.dy - gesture.current.lastY) * MOUSE_SENSITIVITY
        gesture.current.lastX = gestureState.dx
        gesture.current.lastY = gestureState.dy
        const dx = Math.max(-MOUSE_MAX_STEP, Math.min(MOUSE_MAX_STEP, rawDx))
        const dy = Math.max(-MOUSE_MAX_STEP, Math.min(MOUSE_MAX_STEP, rawDy))
        if (dx !== 0 || dy !== 0) onMoveRef.current(dx, dy)
      },
      onPanResponderRelease: (_, gestureState) => {
        const dist = Math.hypot(gestureState.dx, gestureState.dy)
        const dt = Date.now() - gesture.current.startT
        setTouching(false)
        onActiveChangeRef.current(false)
        if (dist <= TAP_MAX_DIST && dt <= TAP_MAX_MS && !disabledRef.current) onTapRef.current()
      },
      onPanResponderTerminate: () => {
        setTouching(false)
        onActiveChangeRef.current(false)
      },
    }),
  ).current

  useEffect(() => {
    if (disabled) {
      setTouching(false)
      onActiveChangeRef.current(false)
    }
  }, [disabled])

  return (
    <View
      accessibilityRole="button"
      accessibilityLabel={t('touchpad.accessibility')}
      testID="fare-paneli"
      {...pan.panHandlers}
      style={[styles.touchpad, touching && styles.touchpadActive]}
    >
      <Feather
        name="move"
        size={44}
        color={touching ? colors.primary : colors.mutedForeground}
      />
      <Text style={styles.touchpadHint}>
        {touching ? t('touchpad.active') : t('touchpad.idle')}
      </Text>
    </View>
  );
}

function ColorKey({
  labelKey,
  labelParams,
  dotColor,
  onPress,
  disabled,
}: {
  labelKey: TranslationKey;
  labelParams?: MessageParams;
  dotColor: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation()
  const label = t(labelKey, labelParams)

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      testID={remoteTestID(labelKey, labelParams)}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.colorKey, pressed && styles.pressed, disabled && styles.disabled]}
    >
      <View style={[styles.colorDot, { backgroundColor: dotColor }]} />
      <Text numberOfLines={1} style={styles.colorLabel}>
        {label}
      </Text>
    </Pressable>
  )
}

/**
 * Ergonomic layout (portrait phone, thumb-first):
 *  1. System row — power + most-used TV functions
 *  2+4. Side rockers (SES left, KANAL right, joined pills) flanking a
 *      round D-pad with OK — physical-remote form, all rockers repeat
 *  3. Nav row — Back / Home / Menu / Exit (highest-frequency after OK)
 *  5. Quick access — Guide / List / Info / Previous channel
 *  6. Numbers (collapsible) — direct channel entry
 *  7. Media — compact icon-only transport row
 *  8. Color keys — data-broadcast red/green/yellow/blue
 *  9. More (collapsible) — rarely used extras
 */
const NUM_PAD: { digit: string; key: number }[] = [
  { digit: '1', key: COMMANDS.NUM_1 },
  { digit: '2', key: COMMANDS.NUM_2 },
  { digit: '3', key: COMMANDS.NUM_3 },
  { digit: '4', key: COMMANDS.NUM_4 },
  { digit: '5', key: COMMANDS.NUM_5 },
  { digit: '6', key: COMMANDS.NUM_6 },
  { digit: '7', key: COMMANDS.NUM_7 },
  { digit: '8', key: COMMANDS.NUM_8 },
  { digit: '9', key: COMMANDS.NUM_9 },
];

function numberCommand(digit: string): RemoteCommand | null {
  const entry = NUM_PAD.find((item) => item.digit === digit)
  if (entry) return createRemoteCommand(entry.key, 'command.digit', 'hash', undefined, { digit })
  if (digit === '0') return createRemoteCommand(COMMANDS.NUM_0, 'command.digit', 'hash', undefined, { digit })
  return null
}

/** Right page (swipe left): direct channel entry + channel tasks. */
function NumberPadPage({
  onCommand,
  busy,
}: {
  onCommand: (command: RemoteCommand) => void;
  busy: boolean;
}) {
  const { t } = useTranslation()
  const pressDigit = (digit: string) => {
    const command = numberCommand(digit)
    if (command) onCommand(command);
  };

  return (
    <View style={styles.remotePanel}>
      <SectionCaption>{t('section.numbers')}</SectionCaption>
      <View style={styles.numberGrid}>
        {NUM_PAD.map((item) => (
          <NumberKey key={item.digit} digit={item.digit} onPress={pressDigit} disabled={busy} />
        ))}
        <IconButton command={createRemoteCommand(COMMANDS.DASH, 'command.dash', 'minus')} onPress={onCommand} disabled={busy} />
        <NumberKey digit="0" onPress={pressDigit} disabled={busy} />
        <IconButton command={createRemoteCommand(COMMANDS.FAVORITE, 'command.favorite', 'star')} onPress={onCommand} disabled={busy} />
      </View>
      <SectionCaption>{t('section.channel')}</SectionCaption>
      <View style={styles.tripleRow}>
        <IconButton command={createRemoteCommand(COMMANDS.PREV_CHANNEL, 'command.previousChannel', 'rotate-ccw')} onPress={onCommand} disabled={busy} />
        <IconButton command={createRemoteCommand(COMMANDS.CHANNEL_LIST, 'command.channelList', 'list')} onPress={onCommand} disabled={busy} />
        <IconButton command={createRemoteCommand(COMMANDS.GUIDE, 'command.guide', 'calendar')} onPress={onCommand} disabled={busy} />
      </View>
    </View>
  );
}

function RemotePad({
  onCommand,
  onRepeatKey,
  busy,
  padSize,
}: {
  onCommand: (command: RemoteCommand) => void;
  onRepeatKey: HoldHandler;
  busy: boolean;
  /** D-pad circle diameter, computed from measured pager height. */
  padSize: number;
}) {
  const { t } = useTranslation()
  const press = (key: number, labelKey: TranslationKey, icon: keyof typeof Feather.glyphMap, tone?: RemoteCommand['tone']) =>
    onCommand(createRemoteCommand(key, labelKey, icon, tone))
  const arrowLen = Math.round(padSize * 0.29);
  const okD = Math.round(padSize * 0.4);

  return (
    <View style={[styles.remotePanel, styles.fillPanel]}>
      {/* 1 — System */}
      <View style={styles.quadRow}>
        <IconButton
          command={createRemoteCommand(COMMANDS.POWER, 'command.power', 'power', 'danger')}
          onPress={onCommand}
          disabled={busy}
        />
        <IconButton
          command={createRemoteCommand(COMMANDS.QUICK_MENU, 'command.quickMenu', 'sliders', 'soft')}
          onPress={onCommand}
          disabled={busy}
        />
        <IconButton
          command={createRemoteCommand(COMMANDS.INPUT, 'command.input', 'monitor', 'soft')}
          onPress={onCommand}
          disabled={busy}
        />
        <IconButton
          command={createRemoteCommand(COMMANDS.APPS, 'command.apps', 'grid', 'soft')}
          onPress={onCommand}
          disabled={busy}
        />
      </View>

      {/* 2+4 — Side rockers + round D-pad (physical-remote form).
          Left: joined SES pill (+ top, − bottom). Right: joined KANAL
          pill. Center: circular D-pad with OK. All rocker halves repeat
          while held. */}
      <View style={styles.clusterRow}>
        <View style={styles.navSide}>
          <Text style={styles.sideCaption}>{t('section.volume')}</Text>
          <View style={styles.rockerPill}>
            <PressHoldButton
              command={createRemoteCommand(COMMANDS.VOLUME_UP, 'command.volumeUp', 'plus')}
              onHold={onRepeatKey}
              disabled={busy}
              flat
              seam
            />
            <PressHoldButton
              command={createRemoteCommand(COMMANDS.VOLUME_DOWN, 'command.volumeDown', 'minus')}
              onHold={onRepeatKey}
              disabled={busy}
              flat
            />
          </View>
        </View>
        <View style={styles.padWrap}>
          <View style={[styles.padCircle, { width: padSize, height: padSize }]}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('command.up')}
               testID={remoteTestID('command.up')}
              disabled={busy}
              onPress={() => press(COMMANDS.UP, 'command.up', 'chevron-up')}
              style={({ pressed }) => [styles.padArrowUp, { height: arrowLen }, pressed && styles.pressed, busy && styles.disabled]}
            >
              <Feather name="chevron-up" size={30} color={colors.foreground} />
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('command.left')}
               testID={remoteTestID('command.left')}
              disabled={busy}
              onPress={() => press(COMMANDS.LEFT, 'command.left', 'chevron-left')}
              style={({ pressed }) => [styles.padArrowLeft, { width: arrowLen }, pressed && styles.pressed, busy && styles.disabled]}
            >
              <Feather name="chevron-left" size={30} color={colors.foreground} />
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('command.ok')}
               testID={remoteTestID('command.ok')}
              disabled={busy}
              onPress={() => press(COMMANDS.OK, 'command.ok', 'circle', 'primary')}
              style={({ pressed }) => [styles.okButton, { width: okD, height: okD, borderRadius: okD / 2 }, pressed && styles.pressed]}
            >
              <Text style={styles.okText}>{t('command.ok')}</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('command.right')}
               testID={remoteTestID('command.right')}
              disabled={busy}
              onPress={() => press(COMMANDS.RIGHT, 'command.right', 'chevron-right')}
              style={({ pressed }) => [styles.padArrowRight, { width: arrowLen }, pressed && styles.pressed, busy && styles.disabled]}
            >
              <Feather name="chevron-right" size={30} color={colors.foreground} />
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('command.down')}
               testID={remoteTestID('command.down')}
              disabled={busy}
              onPress={() => press(COMMANDS.DOWN, 'command.down', 'chevron-down')}
              style={({ pressed }) => [styles.padArrowDown, { height: arrowLen }, pressed && styles.pressed, busy && styles.disabled]}
            >
              <Feather name="chevron-down" size={30} color={colors.foreground} />
            </Pressable>
          </View>
        </View>
        <View style={styles.navSide}>
          <Text style={styles.sideCaption}>{t('section.channelShort')}</Text>
          <View style={styles.rockerPill}>
            <PressHoldButton
              command={createRemoteCommand(COMMANDS.CHANNEL_UP, 'command.channelUp', 'chevron-up')}
              onHold={onRepeatKey}
              disabled={busy}
              flat
              seam
            />
            <PressHoldButton
              command={createRemoteCommand(COMMANDS.CHANNEL_DOWN, 'command.channelDown', 'chevron-down')}
              onHold={onRepeatKey}
              disabled={busy}
              flat
            />
          </View>
        </View>
      </View>

      {/* 3 — Navigation */}
      <View style={styles.quadRow}>
        <IconButton command={createRemoteCommand(COMMANDS.BACK, 'command.back', 'corner-up-left')} onPress={onCommand} disabled={busy} />
        <IconButton command={createRemoteCommand(COMMANDS.HOME, 'command.home', 'home')} onPress={onCommand} disabled={busy} />
        <IconButton command={createRemoteCommand(COMMANDS.MENU, 'command.menu', 'menu')} onPress={onCommand} disabled={busy} />
        <IconButton command={createRemoteCommand(COMMANDS.EXIT, 'command.exit', 'x')} onPress={onCommand} disabled={busy} />
      </View>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('command.mute')}
         testID={remoteTestID('command.mute')}
        disabled={busy}
        onPress={() => press(COMMANDS.MUTE, 'command.mute', 'volume-x')}
        style={({ pressed }) => [styles.muteBar, pressed && styles.pressed, busy && styles.disabled]}
      >
        <Feather name="volume-x" size={18} color={colors.foreground} />
        <Text style={styles.muteBarText}>{t('command.mute')}</Text>
      </Pressable>

      {/* 5 — Quick access */}
      <View style={styles.quadRow}>
        <IconButton command={createRemoteCommand(COMMANDS.GUIDE, 'command.guide', 'calendar')} onPress={onCommand} disabled={busy} />
        <IconButton command={createRemoteCommand(COMMANDS.CHANNEL_LIST, 'command.channelList', 'list')} onPress={onCommand} disabled={busy} />
        <IconButton command={createRemoteCommand(COMMANDS.INFO, 'command.info', 'info')} onPress={onCommand} disabled={busy} />
        <IconButton command={createRemoteCommand(COMMANDS.PREV_CHANNEL, 'command.previousChannel', 'rotate-ccw')} onPress={onCommand} disabled={busy} />
      </View>

      {/* 7 — Media transport */}
      <SectionCaption>{t('section.media')}</SectionCaption>
      <View style={styles.mediaRow}>
        <IconButton command={createRemoteCommand(COMMANDS.REWIND, 'command.rewind', 'rewind')} onPress={onCommand} disabled={busy} iconOnly />
        <IconButton command={createRemoteCommand(COMMANDS.PLAY, 'command.play', 'play')} onPress={onCommand} disabled={busy} iconOnly />
        <IconButton command={createRemoteCommand(COMMANDS.PAUSE, 'command.pause', 'pause')} onPress={onCommand} disabled={busy} iconOnly />
        <IconButton command={createRemoteCommand(COMMANDS.STOP, 'command.stop', 'square')} onPress={onCommand} disabled={busy} iconOnly />
        <IconButton command={createRemoteCommand(COMMANDS.FAST_FORWARD, 'command.fastForward', 'fast-forward')} onPress={onCommand} disabled={busy} iconOnly />
      </View>

      {/* 8 — Color keys */}
      <View style={styles.colorRow}>
        <ColorKey labelKey="command.red" dotColor="#E5484D" onPress={() => press(COMMANDS.RED, 'command.red', 'circle')} disabled={busy} />
        <ColorKey labelKey="command.green" dotColor="#30A46C" onPress={() => press(COMMANDS.GREEN, 'command.green', 'circle')} disabled={busy} />
        <ColorKey labelKey="command.yellow" dotColor="#F5B638" onPress={() => press(COMMANDS.YELLOW, 'command.yellow', 'circle')} disabled={busy} />
        <ColorKey labelKey="command.blue" dotColor="#3E82F7" onPress={() => press(COMMANDS.BLUE, 'command.blue', 'circle')} disabled={busy} />
      </View>

    </View>
  );
}

export default function HomeScreen() {
  const insets = useSafeAreaInsets()
  const { t } = useTranslation()
  const [connection, setConnection] = useState<Connection | null>(null)
  const [host, setHost] = useState('')
  const [pairingKey, setPairingKey] = useState('')
  const [tvName, setTvName] = useState('LG NetCast TV')
  const [status, setStatus] = useState<MessageDescriptor | null>({ key: 'status.initial' })
  const [error, setError] = useState<MessageDescriptor | null>(null)
  const [loading, setLoading] = useState(false)
  const [commandBusy, setCommandBusy] = useState(false)
  const [showPairing, setShowPairing] = useState(false)
  const [discoveredTvs, setDiscoveredTvs] = useState<DiscoveredTv[]>([])
  const [scanning, setScanning] = useState(false)
  const [selectedTvId, setSelectedTvId] = useState('')
  const [page, setPage] = useState(1)
  const [pagerLocked, setPagerLocked] = useState(false)
  const [pagerHeight, setPagerHeight] = useState(0)

  const generationRef = useRef(0)
  const connectionRef = useRef<Connection | null>(null)
  const hostRef = useRef('')
  const pairingControllerRef = useRef<AbortController | null>(null)
  const restoreControllerRef = useRef<AbortController | null>(null)
  const connectionControllerRef = useRef<AbortController | null>(null)
  const commandQueueRef = useRef<SerialRequestQueue | null>(null)
  const commandBusyRef = useRef(false)
  const repeatTokensRef = useRef(new Map<number, object>())
  const scanId = useRef(0)
  const scanControllerRef = useRef<AbortController | null>(null)
  const scanGeneratorRef = useRef<AsyncGenerator<SsdpDevice, void, undefined> | null>(null)
  const notificationGeneratorsRef = useRef(new Map<string, AsyncGenerator<SsdpDevice, void, undefined>>())
  const knownTvAddresses = useRef(new Set<string>())
  const listedTvHostsRef = useRef(new Set<string>())
  const knownTvIds = useRef(new Set<string>())
  const refreshingNotificationHosts = useRef(new Set<string>())
  const notificationOnlineState = useRef(new Map<string, boolean>())
  const liveListenerGeneration = useRef(0)
  const mouseAccum = useRef({ x: 0, y: 0 })
  const mouseTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const mouseFails = useRef(0)

  const connected = Boolean(connection?.session)
  const displayHost = useMemo(() => connection?.host ?? host, [connection?.host, host])

  useEffect(() => {
    if (!connected || Platform.OS !== 'ios' || !status) return
    try {
      AccessibilityInfo.announceForAccessibility(t(status))
    } catch {
      return
    }
  }, [connected, status, t])

  useEffect(() => {
    if (!connected || Platform.OS !== 'ios' || !error) return
    try {
      AccessibilityInfo.announceForAccessibility(t(error))
    } catch {
      return
    }
  }, [connected, error, t])

  const cancelScan = useCallback(() => {
    scanControllerRef.current?.abort()
    scanControllerRef.current = null
    const generator = scanGeneratorRef.current
    scanGeneratorRef.current = null
    if (generator) void generator.return(undefined).catch(() => undefined)
    scanId.current += 1
  }, [])

  const cancelNotificationSearches = useCallback(() => {
    for (const generator of notificationGeneratorsRef.current.values()) {
      void generator.return(undefined).catch(() => undefined)
    }
    notificationGeneratorsRef.current.clear()
    refreshingNotificationHosts.current.clear()
  }, [])

  const clearMouseRuntime = useCallback(() => {
    if (mouseTimer.current !== null) clearTimeout(mouseTimer.current)
    mouseTimer.current = null
    mouseAccum.current = { x: 0, y: 0 }
    mouseFails.current = 0
  }, [])

  const clearConnectionRuntime = useCallback(() => {
    generationRef.current += 1
    pairingControllerRef.current?.abort()
    restoreControllerRef.current?.abort()
    connectionControllerRef.current?.abort()
    connectionControllerRef.current = null
    pairingControllerRef.current = null
    restoreControllerRef.current = null
    commandQueueRef.current?.clear()
    commandQueueRef.current = null
    cancelScan()
    cancelNotificationSearches()
    repeatTokensRef.current.clear()
    connectionRef.current = null
    commandBusyRef.current = false
    clearMouseRuntime()
    setConnection(null)
    setCommandBusy(false)
    setPagerLocked(false)
    setScanning(false)
    setLoading(false)
    return generationRef.current
  }, [cancelNotificationSearches, cancelScan, clearMouseRuntime])

  const handleSessionAuthFailure = useCallback(() => {
    const generation = clearConnectionRuntime()
    setPairingKey('')
    setShowPairing(true)
    setSelectedTvId('')
    setTvName('LG NetCast TV')
    setError({ key: 'error.sessionExpired' })
    setStatus({ key: 'status.pairingWaiting' })
    void clearPersistedConnection().catch(() => {
      if (generation !== generationRef.current) return
      setError({ key: 'error.sessionCleanupFailed' })
    })
  }, [clearConnectionRuntime])

  const activateConnection = useCallback((next: Connection, generation: number) => {
    if (generation !== generationRef.current) return
    commandQueueRef.current?.clear()
    commandQueueRef.current = null
    clearMouseRuntime()
    const queue = new SerialRequestQueue({
      maxPendingEntries: 64,
      maxMoveMagnitude: 240,
      moveTask: (dx, dy, signal) => sendTouchMove(next, dx, dy, signal),
      onBackpressure: () => {
        if (generation !== generationRef.current) return
        setStatus({ key: 'status.mouseBackpressure' })
      },
      onMoveSuccess: () => {
        if (generation === generationRef.current) mouseFails.current = 0
      },
      onMoveError: (error) => {
        if (generation !== generationRef.current) return
        if (isAuthError(error)) {
          handleSessionAuthFailure()
          return
        }
        if (isUnsupportedError(error)) {
          const message = commandFailureMessage(error)
          setError(message)
          setStatus(message)
          return
        }
        mouseFails.current += 1
        if (mouseFails.current >= 3) {
          mouseFails.current = 0
          const message = commandFailureMessage(error)
          setError(message)
          setStatus(message)
        } else {
          setStatus({ key: 'status.mouseSending' })
        }
      },
    })
    commandQueueRef.current = queue
    connectionRef.current = next
    hostRef.current = next.host
    setHost(next.host)
    setTvName(next.name ?? 'LG NetCast TV')
    setPairingKey('')
    setShowPairing(false)
    setSelectedTvId('')
    setError(null)
    commandBusyRef.current = false
    setCommandBusy(false)
    setPagerLocked(false)
    setConnection(next)
  }, [clearMouseRuntime, handleSessionAuthFailure])

  useEffect(() => {
    const controller = new AbortController()
    const generation = ++generationRef.current
    restoreControllerRef.current = controller
    connectionControllerRef.current = controller
    let active = true
    const isCurrent = () => active && generation === generationRef.current && connectionControllerRef.current === controller && !controller.signal.aborted

     void (async () => {
       if (Platform.OS === 'web') {
         if (isCurrent()) {
            setError({ key: 'error.webPairingUnavailable' })
            setStatus({ key: 'status.physicalDeviceRequired' })
          }
         return
       }
       let loaded
      try {
        loaded = await loadPersistedConnection()
      } catch (storageError) {
        if (!isCurrent()) return
        setError(storageError instanceof StorageError ? storageWarningMessage(storageError) : { key: 'error.storageReadGeneric' })
        setStatus({ key: 'status.storageReadFailed' })
        return
      }

      if (!isCurrent()) return
      if (loaded.status === 'missing') return
      if (loaded.status === 'invalid') {
        if (loaded.host) {
          hostRef.current = loaded.host
          setHost(loaded.host)
          setTvName(loaded.name ?? 'LG NetCast TV')
          setSelectedTvId('')
        }
        setShowPairing(true)
        if (loaded.warning) setError(storageWarningMessage(loaded.warning))
        setStatus({ key: 'status.storedConnectionInvalid' })
        void clearPersistedConnection().catch(() => {
          if (isCurrent()) setError({ key: 'error.storedConnectionCleanupFailed' })
        })
        return
      }

      const stored = loaded.connection
      hostRef.current = stored.host
      setHost(stored.host)
      setTvName(stored.name ?? 'LG NetCast TV')
      setStatus({ key: 'status.storedTvSearching' })
      if (loaded.warning) setError(storageWarningMessage(loaded.warning))

      try {
        const session = await createSession(stored.host, stored.accessToken, controller.signal)
        if (!isCurrent()) return
        const next = { ...stored, session }
        activateConnection(next, generation)
        if (loaded.warning) {
          setError(storageWarningMessage(loaded.warning))
          setStatus(storageWarningStatus(loaded.warning))
        } else {
         setStatus({ key: 'status.connectionReady' })
        }
      } catch (restoreError) {
        if (!isCurrent() || isAbortErrorKind(restoreError)) return
        if (isAuthError(restoreError)) {
          if (!isCurrent()) return
          setPairingKey('')
          setShowPairing(true)
          setError({ key: 'error.invalidPairingKey' })
          setStatus({ key: 'status.invalidPairingKey' })
          void clearPersistedConnection().catch(() => {
            if (isCurrent()) setError({ key: 'error.invalidPairingCleanupFailed' })
          })
        } else {
          setError(commandFailureMessage(restoreError))
          setStatus({ key: 'status.storedTvUnreachable' })
        }
      }
    })()

    return () => {
      active = false
      controller.abort()
      if (restoreControllerRef.current === controller) restoreControllerRef.current = null
      if (connectionControllerRef.current === controller) connectionControllerRef.current = null
    }
  }, [activateConnection])

  const scanForTvs = useCallback(async () => {
    clearConnectionRuntime()
    setTvName('LG NetCast TV')
    setPairingKey('')
    setShowPairing(false)
    const currentScanId = ++scanId.current
    const controller = new AbortController()
    scanControllerRef.current = controller
    setScanning(true)
    setDiscoveredTvs([])
    listedTvHostsRef.current.clear()
    setSelectedTvId('')
    setError(null)
    setStatus({ key: 'status.scanning' })

     if (Platform.OS === 'web') {
         setError({ key: 'error.scanWeb' })
       setStatus({ key: 'status.physicalDeviceRequired' })
       scanControllerRef.current = null
      setScanning(false)
      return
    }

    try {
      const foundHosts = new Set<string>()
      const addFoundTv = (tv: DiscoveredTv) => {
        if (controller.signal.aborted || scanId.current !== currentScanId || foundHosts.has(tv.host)) return
        foundHosts.add(tv.host)
        knownTvAddresses.current.add(tv.host)
        knownTvIds.current.add(tv.id)
        listedTvHostsRef.current.add(tv.host)
        setDiscoveredTvs((previous) => upsertDiscoveredTv(previous, tv))
      }

      const unicastTargets = Platform.OS === 'ios' ? Array.from(knownTvAddresses.current) : []
      const canSearchSsdp = isSsdpAvailable && (Platform.OS === 'android' || unicastTargets.length > 0)
      if (canSearchSsdp) {
        const generator = searchStream({
          searchTargets: NETCAST_SEARCH_TARGETS,
          timeoutMs: SSDP_TIMEOUT_MS,
          mx: 3,
          repeatProbe: true,
          multicastEnabled: Platform.OS === 'android',
          broadcastEnabled: Platform.OS === 'android',
          unicastTargets,
        })
        scanGeneratorRef.current = generator
        try {
          for await (const device of generator) {
            if (controller.signal.aborted || scanId.current !== currentScanId) return
            const tv = toNetCastTv(device)
            if (tv) addFoundTv(tv)
          }
        } finally {
          if (scanGeneratorRef.current === generator) scanGeneratorRef.current = null
        }
      }

      if (foundHosts.size === 0) {
        setStatus({ key: 'status.scanSsdpFallback' })
        const localIp = await Network.getIpAddressAsync()
        if (getSafeScanHosts(localIp).length === 0) throw new Error('NO_LOCAL_SUBNET')
        await scanLocalSubnet(localIp, addFoundTv, controller.signal)
      }

      if (controller.signal.aborted || scanId.current !== currentScanId) return
      setStatus(
        foundHosts.size > 0
          ? { key: 'status.scanFound', params: { count: foundHosts.size } }
          : { key: 'status.scanComplete' },
      )
      if (foundHosts.size === 0) {
        setError({ key: 'error.noTvFound' })
      }
    } catch (scanError) {
      if (controller.signal.aborted || scanId.current !== currentScanId) return
      const message = scanError instanceof Error ? scanError.message : ''
      if (message === 'NO_WIFI') {
        setError({ key: 'error.noWifi' })
        setStatus({ key: 'status.localNetworkRequired' })
      } else if (message === 'NO_LOCAL_SUBNET') {
        setError({ key: 'error.noLocalSubnet' })
        setStatus({ key: 'status.manualConnectionWaiting' })
      } else {
        setError({ key: 'error.scanFailed' })
        setStatus({ key: 'status.scanTimeout' })
      }
     } finally {
       if (scanId.current === currentScanId && scanControllerRef.current === controller) {
         scanControllerRef.current = null
         scanGeneratorRef.current = null
         setScanning(false)
       }
     }
  }, [clearConnectionRuntime])

  const markTvOnline = useCallback((event: SsdpNotifyEvent, online: boolean) => {
    setDiscoveredTvs((previous) => {
      const next = previous.map((tv) => {
        if (!tvMatchesNotification(tv, event)) return tv
        return tv.online === online ? tv : { ...tv, online }
      })
      return next
    })
  }, [])

  const markTvHostOnline = useCallback((address: string, online: boolean) => {
    setDiscoveredTvs((previous) => previous.map((tv) => {
      if (!tvMatchesHost(tv, address)) return tv
      return tv.online === online ? tv : { ...tv, online }
    }))
  }, [])

  const refreshTvFromNotification = useCallback(async (
    event: SsdpNotifyEvent,
    generation: number,
    connectionGeneration: number,
  ) => {
    if (
      Platform.OS !== 'android' ||
      !isSsdpAvailable ||
      liveListenerGeneration.current !== generation ||
      generationRef.current !== connectionGeneration ||
      refreshingNotificationHosts.current.has(event.address)
    ) {
      return;
    }

    refreshingNotificationHosts.current.add(event.address)
    const generator = searchStream({
      searchTargets: NETCAST_SEARCH_TARGETS,
      timeoutMs: 2200,
      mx: 1,
      repeatProbe: false,
      multicastEnabled: false,
      broadcastEnabled: false,
      unicastTargets: [event.address],
    })
    notificationGeneratorsRef.current.set(event.address, generator)
    try {
      for await (const device of generator) {
        const tv = toNetCastTv(device)
        if (!tv) continue
        if (
          liveListenerGeneration.current !== generation ||
          generationRef.current !== connectionGeneration ||
          notificationOnlineState.current.get(event.address) !== true
        ) {
          return
        }
        knownTvAddresses.current.add(tv.host)
        knownTvIds.current.add(tv.id)
        listedTvHostsRef.current.add(tv.host)
        setDiscoveredTvs((previous) => upsertDiscoveredTv(previous, tv))
      }
    } catch {
    } finally {
      if (notificationGeneratorsRef.current.get(event.address) === generator) {
        notificationGeneratorsRef.current.delete(event.address)
        refreshingNotificationHosts.current.delete(event.address)
      }
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      const generation = ++liveListenerGeneration.current
      let active = true
      let subscription: { remove: () => void } | undefined

      if (Platform.OS === 'android' && isSsdpAvailable) {
        try {
          subscription = listenForNotifications({
            onAlive: (event) => {
              if (!active || liveListenerGeneration.current !== generation) return
              const knownDevice =
                knownTvAddresses.current.has(event.address) ||
                knownTvIds.current.has(notifyDeviceId(event))
              if (!knownDevice && !notifyLooksLikeNetCast(event)) return
              notificationOnlineState.current.set(event.address, true)
              markTvOnline(event, true)
              void refreshTvFromNotification(event, generation, generationRef.current)
            },
            onUpdate: (event) => {
              if (!active || liveListenerGeneration.current !== generation) return
              const knownDevice =
                knownTvAddresses.current.has(event.address) ||
                knownTvIds.current.has(notifyDeviceId(event))
              if (!knownDevice && !notifyLooksLikeNetCast(event)) return
              notificationOnlineState.current.set(event.address, true)
              markTvOnline(event, true)
              void refreshTvFromNotification(event, generation, generationRef.current)
            },
            onByeBye: (event) => {
              if (!active || liveListenerGeneration.current !== generation || !event.address) return
              if (!listedTvHostsRef.current.has(event.address)) return
              notificationOnlineState.current.set(event.address, false)
              markTvHostOnline(event.address, false)
            },
            onError: () => {
              if (!active || liveListenerGeneration.current !== generation) return
            },
          })
        } catch {
        }
      }

      return () => {
        active = false
        liveListenerGeneration.current += 1
        cancelScan()
        cancelNotificationSearches()
        subscription?.remove()
        refreshingNotificationHosts.current.clear()
        notificationOnlineState.current.clear()
      }
    }, [cancelNotificationSearches, cancelScan, markTvOnline, markTvHostOnline, refreshTvFromNotification]),
  )

  const selectTv = useCallback((tv: DiscoveredTv) => {
    if (!tv.online) return
    const nextHost = normalizeHost(tv.host)
    if (!nextHost) return
    const changed = hostRef.current.trim() !== nextHost
    if (changed) {
      clearConnectionRuntime()
      hostRef.current = nextHost
      setHost(nextHost)
      setTvName('LG NetCast TV')
      setPairingKey('')
      setShowPairing(false)
      setSelectedTvId('')
    }
    setTvName(tv.name)
    setSelectedTvId(tv.id)
    setError(null)
    setStatus({ key: 'status.selectedTv', params: { name: tv.name } })
  }, [clearConnectionRuntime])

  const handleHostChange = useCallback((value: string) => {
    const changed = hostRef.current.trim() !== value.trim()
    hostRef.current = value
    setHost(value)
    if (!changed) return
    clearConnectionRuntime()
    setTvName('LG NetCast TV')
    setSelectedTvId('')
    setPairingKey('')
    setShowPairing(false)
    setError(null)
  }, [clearConnectionRuntime])

  const pair = useCallback(async () => {
    if (Platform.OS === 'web') {
      setError({ key: 'error.webPairingUnavailable' })
      setStatus({ key: 'status.physicalDeviceRequired' })
      return
    }
    const cleanHost = normalizeHost(host)
    const cleanKey = pairingKey.trim()
    setError(null)
    if (!cleanHost) {
      setError({ key: 'error.hostRequired' })
      return
    }

    clearConnectionRuntime()
    const generation = generationRef.current
    const controller = new AbortController()
    pairingControllerRef.current = controller
    connectionControllerRef.current = controller
    setLoading(true)

    try {
      if (!cleanKey) {
        await requestPairingKey(cleanHost, controller.signal)
        if (generation !== generationRef.current || controller.signal.aborted) return
        hostRef.current = cleanHost
        setHost(cleanHost)
        setShowPairing(true)
        setStatus({ key: 'status.pairingCodeRequested' })
        return
      }

      const session = await createSession(cleanHost, cleanKey, controller.signal)
      if (generation !== generationRef.current || controller.signal.aborted) return
      const next: Connection = { host: cleanHost, accessToken: cleanKey, session, name: tvName }
      activateConnection(next, generation)
      setStatus({ key: 'status.connectionReady' })

      try {
        const saved = await savePersistedConnection(next)
        if (generation !== generationRef.current) return
        if (saved.warning) {
          setError(storageWarningMessage(saved.warning))
          setStatus(storageWarningStatus(saved.warning))
        }
      } catch {
        if (generation === generationRef.current) {
          setError({ key: 'error.storageSave' })
          setStatus({ key: 'status.storageSaveWarning' })
        }
      }
    } catch (pairingError) {
      if (generation !== generationRef.current || controller.signal.aborted || isAbortErrorKind(pairingError)) return
      if (isAuthError(pairingError)) {
        setError({ key: 'error.pairingCodeInvalid' })
      } else if (isUnsupportedError(pairingError)) {
        setError({ key: 'error.pairingUnsupported' })
      } else {
        setError({ key: 'error.pairingNetwork' })
      }
    } finally {
      if (generation === generationRef.current) {
        setLoading(false)
        if (pairingControllerRef.current === controller) pairingControllerRef.current = null
      }
    }
  }, [activateConnection, clearConnectionRuntime, host, pairingKey, tvName])

  const flushPendingMouseMove = useCallback(() => {
    if (mouseTimer.current !== null) {
      clearTimeout(mouseTimer.current)
      mouseTimer.current = null
    }
    const generation = generationRef.current
    const dx = Math.round(mouseAccum.current.x)
    const dy = Math.round(mouseAccum.current.y)
    mouseAccum.current = { x: 0, y: 0 }
    const current = connectionRef.current
    const queue = commandQueueRef.current
    if ((dx === 0 && dy === 0) || !current?.session || !queue) return true
    try {
      return queue.enqueueMove(dx, dy)
    } catch {
      if (generation === generationRef.current) setStatus({ key: 'status.mouseQueueFull' })
      return false
    }
  }, [])

  const fireKey = useCallback(async (
    command: RemoteCommand,
    quiet: boolean,
    queueOptions?: { key?: QueueKey; token?: object },
  ) => {
    const current = connectionRef.current
    const queue = commandQueueRef.current
    const generation = generationRef.current
    if (!current?.session || !queue) return
    setError(null)
    flushPendingMouseMove()
    try {
      await queue.enqueue((signal) => sendCommand(current, command.key, signal), queueOptions)
    } catch (error) {
      if (generation !== generationRef.current || connectionRef.current?.session !== current.session) return
      if (error instanceof QueueClosedError || isAbortErrorKind(error)) return
      if (isAuthError(error)) {
        handleSessionAuthFailure()
        return
      }
      const message = commandFailureMessage(error)
      setError(message)
      setStatus(message)
      return
    }
    if (generation !== generationRef.current || connectionRef.current?.session !== current.session) return
    if (!quiet) {
      setStatus({
        key: 'status.command.sent',
        params: { labelKey: command.labelKey, labelParams: command.labelParams },
      })
    }
  }, [flushPendingMouseMove, handleSessionAuthFailure])

  const handleCommand = useCallback(async (command: RemoteCommand) => {
    const current = connectionRef.current
    if (!current?.session || commandBusyRef.current) return
    const generation = generationRef.current
    commandBusyRef.current = true
    setCommandBusy(true)
    try {
      safeImpactHaptic()
      await fireKey(command, false)
    } finally {
      if (generation === generationRef.current) {
        commandBusyRef.current = false
        setCommandBusy(false)
      }
    }
  }, [fireKey])

  const handleRepeatKey = useCallback((command: RemoteCommand, context?: HoldContext) => {
    if (!context?.repeating) {
      void fireKey(command, true)
      return undefined
    }

    const queue = commandQueueRef.current
    if (!queue || !connectionRef.current?.session) return undefined
    let token = repeatTokensRef.current.get(command.key)
    if (!token) {
      token = {}
      repeatTokensRef.current.set(command.key, token)
    }
    const repeatToken = token
    void fireKey(command, true, { key: command.key, token: repeatToken })

    return () => {
      if (repeatTokensRef.current.get(command.key) !== repeatToken) return
      repeatTokensRef.current.delete(command.key)
      queue.cancel(command.key, repeatToken)
    }
  }, [fireKey])

  const pushMouseMove = useCallback((dx: number, dy: number) => {
    if (!connectionRef.current?.session || !commandQueueRef.current) return
    mouseAccum.current.x = Math.max(-240, Math.min(240, mouseAccum.current.x + dx))
    mouseAccum.current.y = Math.max(-240, Math.min(240, mouseAccum.current.y + dy))
    if (mouseTimer.current === null) {
      mouseTimer.current = setTimeout(flushPendingMouseMove, 80)
    }
  }, [flushPendingMouseMove])

  const enqueueTouch = useCallback(async (
    task: (current: Connection, signal: AbortSignal) => Promise<void>,
    successMessage: MessageDescriptor,
  ) => {
    const current = connectionRef.current
    const queue = commandQueueRef.current
    if (!current?.session || !queue || commandBusyRef.current) return
    const generation = generationRef.current
    commandBusyRef.current = true
    setCommandBusy(true)
    try {
      safeImpactHaptic()
      setError(null)
      flushPendingMouseMove()
      await queue.enqueue((signal) => task(current, signal))
      if (generation !== generationRef.current || connectionRef.current?.session !== current.session) return
      setStatus(successMessage)
    } catch (error) {
      if (generation !== generationRef.current || connectionRef.current?.session !== current.session) return
      if (error instanceof QueueClosedError || isAbortErrorKind(error)) return
      if (isAuthError(error)) {
        handleSessionAuthFailure()
        return
      }
      const message = commandFailureMessage(error)
      setError(message)
      setStatus(message)
    } finally {
      if (generation === generationRef.current) {
        commandBusyRef.current = false
        setCommandBusy(false)
      }
    }
  }, [flushPendingMouseMove, handleSessionAuthFailure])

  const handleTouchTap = useCallback(() => {
    void enqueueTouch(sendTouchClick, { key: 'status.touchClickSent' })
  }, [enqueueTouch])

  const handleTouchAction = useCallback((direction: 'up' | 'down') => {
    void enqueueTouch(
      (current, signal) => sendTouchWheel(current, direction, signal),
      { key: direction === 'up' ? 'status.scrollUpSent' : 'status.scrollDownSent' },
    )
  }, [enqueueTouch])

  // --- 3-page pager: [Fare | Kumanda | Sayılar] --------------------------
  const pageWidth = useWindowDimensions().width
  const pagerRef = useRef<ScrollView>(null)

  // Dynamic single-page fit: the D-pad circle grows/shrinks so the whole
  // main page fits the measured pager height with zero scrolling. The
  // width budget keeps 12px breathing room per side so the circle never
  // visually touches the rockers. Leftover vertical slack is distributed
  // between the rows (space-evenly panel).
  const MAIN_FIXED_BUDGET = 365;
  const widthBudget = pageWidth - 40 - 62 * 2 - 16 - 24;
  const heightBudget = pagerHeight > 0 ? pagerHeight - MAIN_FIXED_BUDGET : 200;
  const padSize = Math.max(140, Math.min(196, Math.floor(Math.min(widthBudget, heightBudget))));

  const scrollToPage = useCallback(
    (index: number) => {
      pagerRef.current?.scrollTo({ x: index * pageWidth, animated: true });
    },
    [pageWidth],
  );

  const pages = [
    { index: 0, titleKey: 'page.touchpad' },
    { index: 1, titleKey: 'page.remote' },
    { index: 2, titleKey: 'page.numbers' },
  ] as const

  useEffect(() => () => {
    generationRef.current += 1
    pairingControllerRef.current?.abort()
    restoreControllerRef.current?.abort()
    connectionControllerRef.current?.abort()
    connectionControllerRef.current = null
    pairingControllerRef.current = null
    restoreControllerRef.current = null
    cancelScan()
    cancelNotificationSearches()
    repeatTokensRef.current.clear()
    commandQueueRef.current?.clear()
    commandQueueRef.current = null
    connectionRef.current = null
    commandBusyRef.current = false
    if (mouseTimer.current !== null) clearTimeout(mouseTimer.current)
    mouseTimer.current = null
    mouseAccum.current = { x: 0, y: 0 }
    mouseFails.current = 0
  }, [cancelNotificationSearches, cancelScan])

  const disconnect = useCallback(() => {
    clearConnectionRuntime()
    const generation = generationRef.current
    setPairingKey('')
    setShowPairing(false)
    setSelectedTvId('')
    setTvName('LG NetCast TV')
    setError(null)
    setStatus({ key: 'status.disconnected' })

    void (async () => {
      try {
        await clearPersistedConnection()
      } catch {
        if (generation !== generationRef.current) return
         setError({ key: 'error.disconnectCleanup' })
       setStatus({ key: 'status.disconnected' })
      }
    })()
  }, [clearConnectionRuntime])

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {!connected ? (
        <ScrollView
          contentContainerStyle={[styles.content, { paddingTop: insets.top + 6, paddingBottom: insets.bottom + 8 }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.header}>
            <View style={styles.brandMark}>
              <Feather name="radio" size={19} color={colors.primary} />
            </View>
            <View style={styles.headerText}>
              <Text style={styles.eyebrow}>NETCAST REMOTE</Text>
              <Text style={styles.title}>{t('app.title')}</Text>
            </View>
            <LanguageToggle />
            <View style={[styles.connectionDot, connected && styles.connectionDotOn]} />
          </View>

          <View style={styles.setupCard}>
            <View style={styles.setupIcon}>
              <Feather name="wifi" size={24} color={colors.primary} />
            </View>
            <Text style={styles.cardTitle}>{t('setup.title')}</Text>
            <Text style={styles.cardBody}>{t('setup.body')}</Text>

            <Pressable
              testID="scan-tvs-button"
              accessibilityRole="button"
              accessibilityLabel={scanning ? t('setup.scanning') : t('setup.scan')}
              disabled={scanning}
              onPress={scanForTvs}
              style={({ pressed }) => [styles.scanButton, pressed && styles.pressed, scanning && styles.disabled]}
            >
              {scanning ? (
                <ActivityIndicator size="small" color={colors.primary} />
              ) : (
                <Feather name="search" size={18} color={colors.primary} />
              )}
              <Text style={styles.scanButtonText}>{scanning ? t('setup.scanning') : t('setup.scan')}</Text>
            </Pressable>

            {discoveredTvs.length > 0 ? (
              <View style={styles.discoverySection}>
                <Text style={styles.inputLabel}>{t('setup.discoveryTitle')}</Text>
                <Text style={styles.discoveryStatus}>
                  {t('setup.discoveryStatus', {
                    online: discoveredTvs.filter((tv) => tv.online).length,
                    total: discoveredTvs.length,
                  })}
                </Text>
                {discoveredTvs.map((tv) => (
                  <Pressable
                    key={tv.id}
                     testID={`discovered-tv-${tv.host}`}
                     accessibilityRole="button"
                     accessibilityLabel={`${tv.name}, ${tv.host}, ${t(tv.online ? 'device.online' : 'device.offline')}`}
                    disabled={!tv.online}
                    onPress={() => selectTv(tv)}
                    style={({ pressed }) => [
                      styles.tvOption,
                      selectedTvId === tv.id && styles.tvOptionSelected,
                      !tv.online && styles.tvOptionOffline,
                      pressed && styles.pressed,
                    ]}
                  >
                    <View style={styles.tvOptionIcon}>
                      <Feather name="tv" size={18} color={colors.primary} />
                    </View>
                    <View style={styles.tvOptionInfo}>
                      <Text style={styles.tvOptionName}>{tv.name}</Text>
                      <Text style={styles.tvOptionMeta}>
                        {tv.host}{tv.model && tv.model !== tv.name ? ` · ${tv.model}` : ''}
                      </Text>
                    </View>
                    <View style={styles.tvOptionStatus}>
                      <View style={[styles.tvStatusDot, tv.online ? styles.tvStatusDotOnline : styles.tvStatusDotOffline]} />
                      <Text style={styles.tvStatusText}>{t(tv.online ? 'device.online' : 'device.offline')}</Text>
                    </View>
                    <Feather
                      name={selectedTvId === tv.id ? 'check-circle' : 'chevron-right'}
                      size={19}
                      color={selectedTvId === tv.id ? colors.primary : colors.mutedForeground}
                    />
                  </Pressable>
                ))}
              </View>
            ) : null}

            <Text style={styles.manualLabel}>{t('setup.manual')}</Text>
            {Platform.OS === 'web' ? (
              <Text style={styles.protocolText}>{t('setup.web')}</Text>
            ) : null}
            <Text style={styles.inputLabel}>{t('setup.ipLabel')}</Text>
            <TextInput
              testID="tv-ip-input"
              accessibilityLabel={t('setup.ipLabel')}
              value={host}
              onChangeText={handleHostChange}
              placeholder="192.168.1.42"
              placeholderTextColor={colors.mutedForeground}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="numbers-and-punctuation"
              style={styles.input}
            />

            {showPairing && (
              <>
                <Text style={styles.inputLabel}>{t('setup.pairingLabel')}</Text>
                <TextInput
                  testID="pairing-key-input"
                  accessibilityLabel={t('setup.pairingLabel')}
                  value={pairingKey}
                  onChangeText={setPairingKey}
                  placeholder={t('setup.pairingPlaceholder')}
                  placeholderTextColor={colors.mutedForeground}
                  keyboardType="number-pad"
                  maxLength={8}
                  style={[styles.input, styles.pairingInput]}
                />
              </>
            )}

            {error ? (
              <View style={styles.errorRow}>
                <Feather name="alert-circle" size={16} color={colors.destructive} />
                <Text style={styles.errorText}>{t(error)}</Text>
              </View>
            ) : null}

            <Pressable
              testID="connect-button"
              accessibilityRole="button"
              accessibilityLabel={t(showPairing ? 'setup.pair' : 'setup.requestCode')}
              disabled={loading}
              onPress={pair}
              style={({ pressed }) => [styles.connectButton, pressed && styles.pressed, loading && styles.disabled]}
            >
              {loading ? <ActivityIndicator color={colors.primaryForeground} /> : <Feather name="link" size={18} color={colors.primaryForeground} />}
              <Text style={styles.connectButtonText}>{t(showPairing ? 'setup.pair' : 'setup.requestCode')}</Text>
            </Pressable>

            <View style={styles.protocolNote}>
              <Feather name="shield" size={15} color={colors.mutedForeground} />
              <Text style={styles.protocolText}>SSDP M-SEARCH + B-SEARCH · ROAP / NetCast 3–4</Text>
            </View>
          </View>
        </ScrollView>
      ) : (
        <View style={[styles.connectedRoot, { paddingTop: insets.top + 6, paddingBottom: insets.bottom + 8 }]}>
          <View style={styles.connectedCard}>
            <View style={styles.tvAvatar}>
              <Feather name="tv" size={20} color={colors.primary} />
            </View>
            <View style={styles.connectedInfo}>
              <Text numberOfLines={1} ellipsizeMode="tail" style={styles.connectedName}>
                {tvName}
              </Text>
              <Text
                numberOfLines={1}
                ellipsizeMode="tail"
                style={styles.connectedMeta}
                accessibilityLiveRegion="polite"
              >
                {displayHost} · {status ? t(status) : ''}
              </Text>
            </View>
            <LanguageToggle />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('connected.disconnect')}
              onPress={disconnect}
              style={styles.disconnectButton}
            >
              <Feather name="settings" size={18} color={colors.mutedForeground} />
            </Pressable>
          </View>
             {error ? (
               <View style={styles.errorRow}>
                 <Feather name="alert-circle" size={16} color={colors.destructive} />
                 <Text style={styles.errorText} accessibilityLiveRegion="polite">
                   {t(error)}
                 </Text>
               </View>
             ) : null}
             <View
               style={styles.pagerViewport}
              onLayout={(event) => setPagerHeight(event.nativeEvent.layout.height)}
            >
              <ScrollView
                ref={pagerRef}
                horizontal
                pagingEnabled
                scrollEnabled={!pagerLocked}
                showsHorizontalScrollIndicator={false}
                style={styles.pagerScroll}
                contentOffset={{ x: pageWidth, y: 0 }}
                onMomentumScrollEnd={(event) => {
                  setPage(Math.round(event.nativeEvent.contentOffset.x / pageWidth));
                }}
              >
                {/* Left page — swipe right from main */}
                <View style={[styles.pagerPage, { width: pageWidth }]}>
                  <View style={[styles.remotePanel, styles.fillPanel]}>
                    <SectionCaption>{t('section.touchpad')}</SectionCaption>
                    <TouchPad
                      onMove={pushMouseMove}
                      onTap={handleTouchTap}
                      onActiveChange={setPagerLocked}
                      disabled={commandBusy}
                    />
                    <Text style={styles.touchpadNote}>{t('connected.touchNote')}</Text>
                    <View style={styles.tripleRow}>
                      <IconButton
                        command={createRemoteCommand(-1, 'command.click', 'mouse-pointer')}
                        onPress={handleTouchTap}
                        disabled={commandBusy}
                      />
                      <IconButton
                        command={createRemoteCommand(-1, 'command.scrollUp', 'chevrons-up')}
                        onPress={() => void handleTouchAction('up')}
                        disabled={commandBusy}
                      />
                      <IconButton
                        command={createRemoteCommand(-1, 'command.scrollDown', 'chevrons-down')}
                        onPress={() => void handleTouchAction('down')}
                        disabled={commandBusy}
                      />
                    </View>
                  </View>
                </View>
                {/* Center page — main remote (no inner scroll: fits viewport) */}
                <View style={[styles.pagerPage, { width: pageWidth }]}>
                  <RemotePad
                    onCommand={handleCommand}
                    onRepeatKey={handleRepeatKey}
                    busy={commandBusy}
                    padSize={padSize}
                  />
                </View>
                {/* Right page — swipe left from main */}
                <View style={[styles.pagerPage, { width: pageWidth }]}>
                  <View style={styles.pageCenter}>
                    <NumberPadPage onCommand={handleCommand} busy={commandBusy} />
                  </View>
                </View>
              </ScrollView>
            </View>
            <View style={styles.dotRow} testID="sayfa-gostergesi">
              {pages.map((item) => (
                <Pressable
                  key={item.index}
                  accessibilityRole="button"
                  accessibilityLabel={t('page.goTo', { page: t(item.titleKey) })}
                  accessibilityState={{ selected: page === item.index }}
                  onPress={() => scrollToPage(item.index)}
                  style={styles.dotItem}
                >
                  <View style={[styles.dot, page === item.index && styles.dotActive]} />
                  <Text style={[styles.dotLabel, page === item.index && styles.dotLabelActive]}>
                    {t(item.titleKey)}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>
      )}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { flexGrow: 1, paddingHorizontal: 20 },
  header: { flexDirection: 'row', alignItems: 'center', marginBottom: 28 },
  brandMark: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accent,
    borderWidth: 1,
    borderColor: colors.border,
  },
  headerText: { flex: 1, marginLeft: 12 },
  eyebrow: { color: colors.primary, fontSize: 11, letterSpacing: 1.7, fontWeight: '700' },
  title: { color: colors.foreground, fontSize: 23, fontWeight: '700', marginTop: 3, letterSpacing: -0.5 },
  connectionDot: { width: 9, height: 9, borderRadius: 5, backgroundColor: colors.mutedForeground, opacity: 0.45 },
  connectionDotOn: { backgroundColor: colors.primary, opacity: 1 },
  setupCard: { backgroundColor: colors.card, borderRadius: 26, borderWidth: 1, borderColor: colors.border, padding: 22 },
  setupIcon: { width: 50, height: 50, borderRadius: 17, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center', marginBottom: 17 },
  cardTitle: { color: colors.foreground, fontSize: 21, fontWeight: '700', letterSpacing: -0.3 },
  cardBody: { color: colors.mutedForeground, fontSize: 14, lineHeight: 21, marginTop: 8, marginBottom: 25 },
  scanButton: { height: 52, borderRadius: 15, borderWidth: 1, borderColor: colors.primary, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 9, marginBottom: 20 },
  scanButtonText: { color: colors.primary, fontSize: 15, fontWeight: '700' },
  discoverySection: { marginBottom: 20 },
  discoveryStatus: { color: colors.mutedForeground, fontSize: 11, marginTop: -3, marginBottom: 10 },
  tvOption: { minHeight: 62, borderRadius: 15, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.secondary, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, marginBottom: 8 },
  tvOptionSelected: { borderColor: colors.primary, backgroundColor: colors.accent },
  tvOptionOffline: { opacity: 0.62 },
  tvOptionIcon: { width: 36, height: 36, borderRadius: 12, backgroundColor: colors.card, alignItems: 'center', justifyContent: 'center' },
  tvOptionInfo: { flex: 1, marginHorizontal: 10 },
  tvOptionName: { color: colors.foreground, fontSize: 14, fontWeight: '700' },
  tvOptionMeta: { color: colors.mutedForeground, fontSize: 11, marginTop: 3 },
  tvOptionStatus: { alignItems: 'flex-end', marginRight: 8, gap: 4 },
  tvStatusDot: { width: 7, height: 7, borderRadius: 4 },
  tvStatusDotOnline: { backgroundColor: colors.primary },
  tvStatusDotOffline: { backgroundColor: colors.mutedForeground },
  tvStatusText: { color: colors.mutedForeground, fontSize: 9, fontWeight: '700' },
  manualLabel: { color: colors.mutedForeground, fontSize: 10, fontWeight: '700', letterSpacing: 1.2, marginBottom: 12 },
  inputLabel: { color: colors.mutedForeground, fontSize: 10, fontWeight: '700', letterSpacing: 1.4, marginBottom: 8 },
  input: { height: 52, borderRadius: 14, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.input, color: colors.foreground, paddingHorizontal: 16, fontSize: 16, marginBottom: 16 },
  pairingInput: { letterSpacing: 2.4 },
  connectButton: { height: 54, borderRadius: 16, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 9, marginTop: 4 },
  connectButtonText: { color: colors.primaryForeground, fontSize: 15, fontWeight: '700' },
  protocolNote: { alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 7, marginTop: 17 },
  protocolText: { color: colors.mutedForeground, fontSize: 11 },
  errorRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 10 },
  errorText: { flex: 1, color: colors.destructive, fontSize: 13, lineHeight: 19 },
  connectedCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.card, borderRadius: 18, borderWidth: 1, borderColor: colors.border, padding: 10, marginBottom: 10 },
  tvAvatar: { width: 42, height: 42, borderRadius: 14, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  connectedInfo: { flex: 1, minWidth: 0, marginLeft: 11 },
  connectedName: { minWidth: 0, color: colors.foreground, fontSize: 15, fontWeight: '700' },
  connectedMeta: { minWidth: 0, color: colors.mutedForeground, fontSize: 11, marginTop: 4 },
  disconnectButton: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center' },
  remotePanel: { backgroundColor: colors.card, borderRadius: 22, borderWidth: 1, borderColor: colors.border, padding: 12 },
  quadRow: { flexDirection: 'row', gap: 8, marginBottom: 10 },
  tripleRow: { flexDirection: 'row', gap: 8, marginBottom: 4 },
  iconButton: { flex: 1, minHeight: 48, borderRadius: 14, backgroundColor: colors.secondary, alignItems: 'center', justifyContent: 'center', gap: 4, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 4 },
  primaryButton: { backgroundColor: colors.primary, borderColor: colors.primary },
  dangerButton: { backgroundColor: '#49252C', borderColor: '#71343C' },
  buttonLabel: { color: colors.foreground, fontSize: 10, fontWeight: '600', textAlign: 'center' },
  primaryLabel: { color: colors.primaryForeground },
  sectionCaption: { color: colors.mutedForeground, fontSize: 10, fontWeight: '700', letterSpacing: 1.4, marginBottom: 8, marginLeft: 4 },
  pressed: { opacity: 0.66, transform: [{ scale: 0.97 }] },
  disabled: { opacity: 0.55 },
  clusterRow: { flexDirection: 'row', gap: 8, alignItems: 'stretch', marginBottom: 4 },
  navSide: { width: 62 },
  sideCaption: { color: colors.mutedForeground, fontSize: 10, fontWeight: '700', letterSpacing: 1.2, textAlign: 'center', marginBottom: 6 },
  rockerPill: { flex: 1, borderRadius: 18, backgroundColor: colors.muted, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' },
  rockerHalf: { flex: 1, minHeight: 0, backgroundColor: 'transparent', borderWidth: 0, borderRadius: 0 },
  rockerSeam: { borderBottomWidth: 1, borderBottomColor: colors.border },
  padWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  padCircle: { width: '100%', maxWidth: 204, aspectRatio: 1, borderRadius: 999, backgroundColor: colors.secondary, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  padArrowUp: { position: 'absolute', top: 2, left: 0, right: 0, height: 58, alignItems: 'center', justifyContent: 'center' },
  padArrowDown: { position: 'absolute', bottom: 2, left: 0, right: 0, height: 58, alignItems: 'center', justifyContent: 'center' },
  padArrowLeft: { position: 'absolute', left: 2, top: 0, bottom: 0, width: 58, alignItems: 'center', justifyContent: 'center' },
  padArrowRight: { position: 'absolute', right: 2, top: 0, bottom: 0, width: 58, alignItems: 'center', justifyContent: 'center' },
  okButton: { width: 78, height: 78, borderRadius: 39, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primary, borderWidth: 5, borderColor: colors.accent },
  okText: { color: colors.primaryForeground, fontSize: 15, fontWeight: '800', letterSpacing: 0.4 },
  connectedRoot: { flex: 1, paddingHorizontal: 20 },
  pagerViewport: { flex: 1, marginHorizontal: -20 },
  pagerScroll: { flex: 1 },
  pagerPage: { paddingHorizontal: 20 },
  fillPanel: { flex: 1, justifyContent: 'space-evenly' },
  pageCenter: { flex: 1, justifyContent: 'center' },
  dotRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, marginTop: 6 },
  dotItem: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 6, paddingHorizontal: 10 },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.mutedForeground, opacity: 0.5 },
  dotActive: { backgroundColor: colors.primary, opacity: 1 },
  dotLabel: { color: colors.mutedForeground, fontSize: 11, fontWeight: '600' },
  dotLabelActive: { color: colors.primary, fontWeight: '700' },
  touchpad: { flex: 1, minHeight: 100, borderRadius: 20, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.secondary, alignItems: 'center', justifyContent: 'center', gap: 12 },
  touchpadActive: { borderColor: colors.primary, backgroundColor: colors.accent },
  touchpadHint: { color: colors.mutedForeground, fontSize: 12, textAlign: 'center', paddingHorizontal: 24 },
  touchpadNote: { color: colors.mutedForeground, fontSize: 11, textAlign: 'center', marginTop: 10, marginBottom: 12 },
  muteBar: { minHeight: 44, borderRadius: 14, backgroundColor: colors.secondary, borderWidth: 1, borderColor: colors.border, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 10 },
  muteBarText: { color: colors.foreground, fontSize: 13, fontWeight: '700' },
  mediaRow: { flexDirection: 'row', gap: 8, marginBottom: 10 },
  numberGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 },
  numberKey: { width: '31%', minHeight: 56, borderRadius: 14, backgroundColor: colors.secondary, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  numberKeyText: { color: colors.foreground, fontSize: 20, fontWeight: '700' },
  colorRow: { flexDirection: 'row', gap: 8, marginBottom: 2 },
  colorKey: { flex: 1, minHeight: 52, borderRadius: 14, backgroundColor: colors.secondary, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center', gap: 6 },
  colorDot: { width: 16, height: 16, borderRadius: 8 },
  colorLabel: { color: colors.foreground, fontSize: 10, fontWeight: '600' },
});