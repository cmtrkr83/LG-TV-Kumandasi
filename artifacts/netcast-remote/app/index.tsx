import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import { isAvailable as isSsdpAvailable, searchStream, getNetworkInterfaces, type SsdpDevice } from 'expo-ssdp';
import { Feather } from '@expo/vector-icons';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import colors from '@/constants/colors';

const STORAGE_KEY = 'netcast-remote-connection';
const XML_HEADER = '<?xml version="1.0" encoding="utf-8"?>';
const PORT = 8080;

type Connection = {
  host: string;
  accessToken: string;
  session?: string;
  name?: string;
};

type DiscoveredTv = {
  id: string;
  host: string;
  name: string;
  model?: string;
  server?: string;
};

type RemoteCommand = {
  key: number;
  label: string;
  icon: keyof typeof Feather.glyphMap;
  tone?: 'primary' | 'soft' | 'danger';
};

const COMMANDS = {
  POWER: 1,
  UP: 12,
  DOWN: 13,
  LEFT: 14,
  RIGHT: 15,
  OK: 20,
  HOME: 21,
  BACK: 23,
  VOLUME_UP: 24,
  VOLUME_DOWN: 25,
  MUTE: 26,
  CHANNEL_UP: 27,
  CHANNEL_DOWN: 28,
  PLAY: 33,
  PAUSE: 34,
  STOP: 35,
  INPUT: 47,
  APPS: 417,
} as const;

const SSDP_TIMEOUT_MS = 8000;

function tvUrl(host: string, path: string) {
  return `http://${host.trim()}:${PORT}/roap/api/${path}`;
}

async function postXml(url: string, body: string) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/atom+xml' },
    body,
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`TV yanıtı ${response.status}`);
  }
  return text;
}

function xmlValue(xml: string, tag: string) {
  const match = xml.match(new RegExp(`<${tag}>([^<]+)</${tag}>`));
  return match?.[1] ?? '';
}

function getSsdpHeader(device: SsdpDevice, ...names: string[]) {
  const headers = device.headers ?? {};
  for (const name of names) {
    const matchingKey = Object.keys(headers).find((key) => key.toLowerCase() === name.toLowerCase());
    if (matchingKey && headers[matchingKey]) return headers[matchingKey];
  }
  return '';
}

function toNetCastTv(device: SsdpDevice): DiscoveredTv | null {
  const model = getSsdpHeader(device, 'modelname', 'model-name', 'model', 'friendlyname', 'device-name');
  const server = device.server ?? getSsdpHeader(device, 'server');
  const responseText = [
    model,
    server,
    device.st,
    device.usn,
    device.location,
    ...Object.values(device.headers ?? {}),
  ]
    .join(' ')
    .toLowerCase();

  if (!/lg|lge|netcast/.test(responseText)) return null;

  return {
    id: device.usn?.split('::')[0] || `${device.address}:${device.location ?? ''}`,
    host: device.address,
    name: model || 'LG NetCast TV',
    model: model || undefined,
    server: server || undefined,
  };
}

async function requestPairingKey(host: string) {
  return postXml(
    tvUrl(host, 'auth'),
    `${XML_HEADER}<auth><type>AuthKeyReq</type></auth>`,
  );
}

async function createSession(host: string, accessToken: string) {
  const response = await postXml(
    tvUrl(host, 'auth'),
    `${XML_HEADER}<auth><type>AuthReq</type><value>${accessToken}</value></auth>`,
  );
  const session = xmlValue(response, 'session');
  if (!session) {
    throw new Error('Eşleştirme anahtarı kabul edilmedi.');
  }
  return session;
}

async function sendCommand(connection: Connection, key: number) {
  if (!connection.session) {
    throw new Error('TV bağlantısı hazır değil.');
  }
  await postXml(
    tvUrl(connection.host, 'command'),
    `${XML_HEADER}<command><session>${connection.session}</session><type>HandleKeyInput</type><value>${key}</value></command>`,
  );
}

function IconButton({
  command,
  onPress,
  disabled,
}: {
  command: RemoteCommand;
  onPress: (command: RemoteCommand) => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={command.label}
      testID={`remote-${command.label}`}
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
      <Text
        style={[
          styles.buttonLabel,
          command.tone === 'primary' && styles.primaryLabel,
        ]}
      >
        {command.label}
      </Text>
    </Pressable>
  );
}

function RemotePad({
  onCommand,
  busy,
}: {
  onCommand: (command: RemoteCommand) => void;
  busy: boolean;
}) {
  const press = (key: number, label: string, icon: keyof typeof Feather.glyphMap, tone?: RemoteCommand['tone']) =>
    onCommand({ key, label, icon, tone });

  return (
    <View style={styles.remotePanel}>
      <View style={styles.topRemoteRow}>
        <IconButton
          command={{ key: COMMANDS.POWER, label: 'Güç', icon: 'power', tone: 'danger' }}
          onPress={onCommand}
          disabled={busy}
        />
        <IconButton
          command={{ key: COMMANDS.INPUT, label: 'Giriş', icon: 'monitor', tone: 'soft' }}
          onPress={onCommand}
          disabled={busy}
        />
        <IconButton
          command={{ key: COMMANDS.APPS, label: 'Uygulamalar', icon: 'grid', tone: 'soft' }}
          onPress={onCommand}
          disabled={busy}
        />
      </View>

      <View style={styles.directionPad}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Yukarı"
          testID="remote-yukari"
          disabled={busy}
          onPress={() => press(COMMANDS.UP, 'Yukarı', 'chevron-up')}
          style={({ pressed }) => [styles.directionButton, styles.upButton, pressed && styles.pressed]}
        >
          <Feather name="chevron-up" size={26} color={colors.foreground} />
        </Pressable>
        <View style={styles.middleDirectionRow}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Sol"
            testID="remote-sol"
            disabled={busy}
            onPress={() => press(COMMANDS.LEFT, 'Sol', 'chevron-left')}
            style={({ pressed }) => [styles.directionButton, pressed && styles.pressed]}
          >
            <Feather name="chevron-left" size={26} color={colors.foreground} />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Tamam"
            testID="remote-tamam"
            disabled={busy}
            onPress={() => press(COMMANDS.OK, 'Tamam', 'circle', 'primary')}
            style={({ pressed }) => [styles.okButton, pressed && styles.pressed]}
          >
            <Text style={styles.okText}>OK</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Sağ"
            testID="remote-sag"
            disabled={busy}
            onPress={() => press(COMMANDS.RIGHT, 'Sağ', 'chevron-right')}
            style={({ pressed }) => [styles.directionButton, pressed && styles.pressed]}
          >
            <Feather name="chevron-right" size={26} color={colors.foreground} />
          </Pressable>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Aşağı"
          testID="remote-asagi"
          disabled={busy}
          onPress={() => press(COMMANDS.DOWN, 'Aşağı', 'chevron-down')}
          style={({ pressed }) => [styles.directionButton, styles.downButton, pressed && styles.pressed]}
        >
          <Feather name="chevron-down" size={26} color={colors.foreground} />
        </Pressable>
      </View>

      <View style={styles.utilityRow}>
        <IconButton command={{ key: COMMANDS.BACK, label: 'Geri', icon: 'corner-up-left' }} onPress={onCommand} disabled={busy} />
        <IconButton command={{ key: COMMANDS.HOME, label: 'Ana Menü', icon: 'home' }} onPress={onCommand} disabled={busy} />
        <IconButton command={{ key: COMMANDS.MUTE, label: 'Sessiz', icon: 'volume-x' }} onPress={onCommand} disabled={busy} />
      </View>

      <View style={styles.volumeChannelGrid}>
        <View style={styles.stackControl}>
          <Text style={styles.controlCaption}>SES</Text>
          <IconButton command={{ key: COMMANDS.VOLUME_UP, label: 'Ses artır', icon: 'plus' }} onPress={onCommand} disabled={busy} />
          <IconButton command={{ key: COMMANDS.VOLUME_DOWN, label: 'Ses azalt', icon: 'minus' }} onPress={onCommand} disabled={busy} />
        </View>
        <View style={styles.stackControl}>
          <Text style={styles.controlCaption}>KANAL</Text>
          <IconButton command={{ key: COMMANDS.CHANNEL_UP, label: 'Kanal artır', icon: 'chevron-up' }} onPress={onCommand} disabled={busy} />
          <IconButton command={{ key: COMMANDS.CHANNEL_DOWN, label: 'Kanal azalt', icon: 'chevron-down' }} onPress={onCommand} disabled={busy} />
        </View>
      </View>

      <View style={styles.mediaRow}>
        <IconButton command={{ key: COMMANDS.PLAY, label: 'Oynat', icon: 'play' }} onPress={onCommand} disabled={busy} />
        <IconButton command={{ key: COMMANDS.PAUSE, label: 'Duraklat', icon: 'pause' }} onPress={onCommand} disabled={busy} />
        <IconButton command={{ key: COMMANDS.STOP, label: 'Durdur', icon: 'square' }} onPress={onCommand} disabled={busy} />
      </View>
    </View>
  );
}

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const [connection, setConnection] = useState<Connection | null>(null);
  const [host, setHost] = useState('');
  const [pairingKey, setPairingKey] = useState('');
  const [tvName, setTvName] = useState('LG NetCast TV');
  const [status, setStatus] = useState('TV IP adresini girerek başlayın.');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [commandBusy, setCommandBusy] = useState(false);
  const [showPairing, setShowPairing] = useState(false);
  const [discoveredTvs, setDiscoveredTvs] = useState<DiscoveredTv[]>([]);
  const [scanning, setScanning] = useState(false);
  const [selectedTvId, setSelectedTvId] = useState('');
  const scanId = useRef(0);

  const connected = Boolean(connection?.session);
  const displayHost = useMemo(() => connection?.host ?? host, [connection?.host, host]);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then(async (saved) => {
        if (!saved) return;
        const stored = JSON.parse(saved) as Connection;
        setHost(stored.host);
        setPairingKey(stored.accessToken);
        setStatus('Kayıtlı TV aranıyor…');
        try {
          const session = await createSession(stored.host, stored.accessToken);
          setConnection({ ...stored, session });
          setTvName(stored.name ?? 'LG NetCast TV');
          setStatus('Bağlantı hazır');
        } catch {
          setStatus('Kayıtlı bağlantı yeniden eşleştirme bekliyor.');
        }
      })
      .catch(() => setStatus('Bağlantı bilgileri okunamadı.'));
  }, []);

  const scanForTvs = useCallback(async () => {
    const currentScanId = ++scanId.current;
    setScanning(true);
    setDiscoveredTvs([]);
    setSelectedTvId('');
    setError('');
    setStatus('Ağdaki NetCast TV’ler aranıyor…');

    if (Platform.OS === 'web') {
      setError('Ağ taraması yalnızca fiziksel Android/iOS cihazlarda kullanılabilir. IP adresini elle girebilirsiniz.');
      setStatus('Elle bağlantı bekleniyor.');
      setScanning(false);
      return;
    }

    if (!isSsdpAvailable) {
      setError('Ağ taraması bu Expo Go oturumunda kullanılamıyor. SSDP destekli geliştirme derlemesini açın veya IP adresini elle girin.');
      setStatus('Geliştirme derlemesi gerekli.');
      setScanning(false);
      return;
    }

    try {
      const interfaces = await getNetworkInterfaces();
      if (interfaces.length === 0) {
        throw new Error('NO_WIFI');
      }

      const foundHosts = new Set<string>();
      for await (const device of searchStream({
        searchTargets: ['ssdp:all'],
        timeoutMs: SSDP_TIMEOUT_MS,
        mx: 3,
        repeatProbe: true,
        multicastEnabled: Platform.OS === 'android',
        broadcastEnabled: true,
      })) {
        if (scanId.current !== currentScanId) return;
        const tv = toNetCastTv(device);
        if (!tv) continue;
        if (foundHosts.has(tv.host)) continue;
        foundHosts.add(tv.host);
        setDiscoveredTvs((previous) => {
          if (previous.some((item) => item.id === tv.id || item.host === tv.host)) return previous;
          return [...previous, tv];
        });
      }

      if (scanId.current !== currentScanId) return;
      setStatus(
        foundHosts.size > 0
          ? `${foundHosts.size} TV bulundu. Eşleştirmek için birini seçin.`
          : 'Tarama tamamlandı.',
      );
      if (foundHosts.size === 0) {
        setError('NetCast TV bulunamadı. Telefonun ve TV’nin aynı Wi‑Fi ağında olduğundan emin olun.');
      }
    } catch (scanError) {
      if (scanId.current !== currentScanId) return;
      const message = scanError instanceof Error ? scanError.message : '';
      if (message === 'NO_WIFI') {
        setError('Wi‑Fi bağlantısı bulunamadı. Telefonu TV ile aynı yerel ağa bağlayın.');
        setStatus('Yerel ağ bağlantısı gerekli.');
      } else {
        setError('Yerel ağ taraması tamamlanamadı. Android ağ izinlerini ve Wi‑Fi bağlantısını kontrol edin.');
        setStatus('Tarama zaman aşımına uğradı.');
      }
    } finally {
      if (scanId.current === currentScanId) setScanning(false);
    }
  }, []);

  const selectTv = useCallback((tv: DiscoveredTv) => {
    setHost(tv.host);
    setTvName(tv.name);
    setPairingKey('');
    setShowPairing(false);
    setSelectedTvId(tv.id);
    setError('');
    setStatus(`${tv.name} seçildi. TV ekranında kod istemek için devam edin.`);
  }, []);

  const pair = useCallback(async () => {
    const cleanHost = host.trim();
    const cleanKey = pairingKey.trim();
    setError('');
    if (!cleanHost) {
      setError('Bir TV seçin veya yerel IP adresini girin. Örnek: 192.168.1.42');
      return;
    }
    if (!cleanKey) {
      setLoading(true);
      try {
        await requestPairingKey(cleanHost);
        setShowPairing(true);
        setStatus('TV ekranındaki 6 haneli kodu girin.');
      } catch {
        setError('TV’ye ulaşılamadı. Aynı Wi‑Fi ağında olduğunuzu ve NetCast ağ bağlantısının açık olduğunu kontrol edin.');
      } finally {
        setLoading(false);
      }
      return;
    }

    setLoading(true);
    try {
      const session = await createSession(cleanHost, cleanKey);
      const saved: Connection = { host: cleanHost, accessToken: cleanKey, session, name: tvName };
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
      setConnection(saved);
      setShowPairing(false);
      setStatus('Bağlantı hazır');
    } catch {
      setError('Kod doğrulanamadı. TV’de görünen kodu eksiksiz girin.');
    } finally {
      setLoading(false);
    }
  }, [host, pairingKey, tvName]);

  const handleCommand = useCallback(
    async (command: RemoteCommand) => {
      if (!connection) return;
      setCommandBusy(true);
      setError('');
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      try {
        await sendCommand(connection, command.key);
        setStatus(`${command.label} gönderildi`);
      } catch {
        setError('TV yanıt vermedi. Bağlantı kesilmiş olabilir.');
        setConnection(null);
        setStatus('Yeniden bağlanmanız gerekiyor.');
      } finally {
        setCommandBusy(false);
      }
    },
    [connection],
  );

  const disconnect = async () => {
    await AsyncStorage.removeItem(STORAGE_KEY);
    setConnection(null);
    setPairingKey('');
    setStatus('Bağlantı kaldırıldı.');
  };

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={[styles.content, { paddingTop: insets.top + 18, paddingBottom: insets.bottom + 24 }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <View style={styles.brandMark}>
            <Feather name="radio" size={19} color={colors.primary} />
          </View>
          <View style={styles.headerText}>
            <Text style={styles.eyebrow}>NETCAST REMOTE</Text>
            <Text style={styles.title}>TV kumandanız.</Text>
          </View>
          <View style={[styles.connectionDot, connected && styles.connectionDotOn]} />
        </View>

        {!connected ? (
          <View style={styles.setupCard}>
            <View style={styles.setupIcon}>
              <Feather name="wifi" size={24} color={colors.primary} />
            </View>
            <Text style={styles.cardTitle}>TV’ye bağlanın</Text>
            <Text style={styles.cardBody}>
              Telefon ve LG NetCast TV aynı Wi‑Fi ağında olmalı. Önce ağda otomatik arayın veya IP adresini elle girin.
            </Text>

            <Pressable
              testID="scan-tvs-button"
              accessibilityRole="button"
              disabled={scanning}
              onPress={scanForTvs}
              style={({ pressed }) => [styles.scanButton, pressed && styles.pressed, scanning && styles.disabled]}
            >
              {scanning ? (
                <ActivityIndicator size="small" color={colors.primary} />
              ) : (
                <Feather name="search" size={18} color={colors.primary} />
              )}
              <Text style={styles.scanButtonText}>{scanning ? 'Ağ taranıyor…' : 'Ağdaki TV’leri tara'}</Text>
            </Pressable>

            {discoveredTvs.length > 0 ? (
              <View style={styles.discoverySection}>
                <Text style={styles.inputLabel}>BULUNAN TV’LER</Text>
                {discoveredTvs.map((tv) => (
                  <Pressable
                    key={tv.id}
                    testID={`discovered-tv-${tv.host}`}
                    accessibilityRole="button"
                    accessibilityLabel={`${tv.name}, ${tv.host}`}
                    onPress={() => selectTv(tv)}
                    style={({ pressed }) => [
                      styles.tvOption,
                      selectedTvId === tv.id && styles.tvOptionSelected,
                      pressed && styles.pressed,
                    ]}
                  >
                    <View style={styles.tvOptionIcon}>
                      <Feather name="tv" size={18} color={colors.primary} />
                    </View>
                    <View style={styles.tvOptionInfo}>
                      <Text style={styles.tvOptionName}>{tv.name}</Text>
                      <Text style={styles.tvOptionMeta}>{tv.host}{tv.model && tv.model !== tv.name ? ` · ${tv.model}` : ''}</Text>
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

            <Text style={styles.manualLabel}>VEYA IP ADRESİYLE DEVAM EDİN</Text>
            <Text style={styles.inputLabel}>TV IP ADRESİ</Text>
            <TextInput
              testID="tv-ip-input"
              value={host}
              onChangeText={setHost}
              placeholder="192.168.1.42"
              placeholderTextColor={colors.mutedForeground}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="numbers-and-punctuation"
              style={styles.input}
            />

            {showPairing && (
              <>
                <Text style={styles.inputLabel}>TV EŞLEŞTİRME KODU</Text>
                <TextInput
                  testID="pairing-key-input"
                  value={pairingKey}
                  onChangeText={setPairingKey}
                  placeholder="TV ekranındaki 6 haneli kod"
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
                <Text style={styles.errorText}>{error}</Text>
              </View>
            ) : null}

            <Pressable
              testID="connect-button"
              accessibilityRole="button"
              disabled={loading}
              onPress={pair}
              style={({ pressed }) => [styles.connectButton, pressed && styles.pressed, loading && styles.disabled]}
            >
              {loading ? <ActivityIndicator color={colors.primaryForeground} /> : <Feather name="link" size={18} color={colors.primaryForeground} />}
              <Text style={styles.connectButtonText}>{showPairing ? 'TV’yi eşleştir' : 'TV’den kod iste'}</Text>
            </Pressable>

            <View style={styles.protocolNote}>
              <Feather name="shield" size={15} color={colors.mutedForeground} />
              <Text style={styles.protocolText}>SSDP M-SEARCH + B-SEARCH · ROAP / NetCast 3–4</Text>
            </View>
          </View>
        ) : (
          <>
            <View style={styles.connectedCard}>
              <View style={styles.tvAvatar}>
                <Feather name="tv" size={20} color={colors.primary} />
              </View>
              <View style={styles.connectedInfo}>
                <Text style={styles.connectedName}>{tvName}</Text>
                <Text style={styles.connectedMeta}>{displayHost} · {status}</Text>
              </View>
              <Pressable accessibilityRole="button" accessibilityLabel="Bağlantıyı kaldır" onPress={disconnect} style={styles.disconnectButton}>
                <Feather name="settings" size={18} color={colors.mutedForeground} />
              </Pressable>
            </View>
            {error ? (
              <View style={styles.errorRow}>
                <Feather name="alert-circle" size={16} color={colors.destructive} />
                <Text style={styles.errorText}>{error}</Text>
              </View>
            ) : null}
            <RemotePad onCommand={handleCommand} busy={commandBusy} />
            <Text style={styles.statusText}>{status}</Text>
          </>
        )}
      </ScrollView>
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
  tvOption: { minHeight: 62, borderRadius: 15, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.secondary, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, marginBottom: 8 },
  tvOptionSelected: { borderColor: colors.primary, backgroundColor: colors.accent },
  tvOptionIcon: { width: 36, height: 36, borderRadius: 12, backgroundColor: colors.card, alignItems: 'center', justifyContent: 'center' },
  tvOptionInfo: { flex: 1, marginHorizontal: 10 },
  tvOptionName: { color: colors.foreground, fontSize: 14, fontWeight: '700' },
  tvOptionMeta: { color: colors.mutedForeground, fontSize: 11, marginTop: 3 },
  manualLabel: { color: colors.mutedForeground, fontSize: 10, fontWeight: '700', letterSpacing: 1.2, marginBottom: 12 },
  inputLabel: { color: colors.mutedForeground, fontSize: 10, fontWeight: '700', letterSpacing: 1.4, marginBottom: 8 },
  input: { height: 52, borderRadius: 14, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.input, color: colors.foreground, paddingHorizontal: 16, fontSize: 16, marginBottom: 16 },
  pairingInput: { letterSpacing: 2.4 },
  connectButton: { height: 54, borderRadius: 16, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 9, marginTop: 4 },
  connectButtonText: { color: colors.primaryForeground, fontSize: 15, fontWeight: '700' },
  protocolNote: { alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 7, marginTop: 17 },
  protocolText: { color: colors.mutedForeground, fontSize: 11 },
  errorRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 15 },
  errorText: { flex: 1, color: colors.destructive, fontSize: 13, lineHeight: 19 },
  connectedCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.card, borderRadius: 20, borderWidth: 1, borderColor: colors.border, padding: 14, marginBottom: 18 },
  tvAvatar: { width: 42, height: 42, borderRadius: 14, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  connectedInfo: { flex: 1, marginLeft: 11 },
  connectedName: { color: colors.foreground, fontSize: 15, fontWeight: '700' },
  connectedMeta: { color: colors.mutedForeground, fontSize: 11, marginTop: 4 },
  disconnectButton: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center' },
  remotePanel: { backgroundColor: colors.card, borderRadius: 28, borderWidth: 1, borderColor: colors.border, padding: 16 },
  topRemoteRow: { flexDirection: 'row', gap: 9, marginBottom: 18 },
  iconButton: { flex: 1, minHeight: 48, borderRadius: 14, backgroundColor: colors.secondary, alignItems: 'center', justifyContent: 'center', gap: 4, borderWidth: 1, borderColor: colors.border },
  primaryButton: { backgroundColor: colors.primary, borderColor: colors.primary },
  dangerButton: { backgroundColor: '#49252C', borderColor: '#71343C' },
  buttonLabel: { color: colors.foreground, fontSize: 10, fontWeight: '600' },
  primaryLabel: { color: colors.primaryForeground },
  pressed: { opacity: 0.66, transform: [{ scale: 0.97 }] },
  disabled: { opacity: 0.55 },
  directionPad: { alignItems: 'center', marginBottom: 18 },
  directionButton: { width: 64, height: 48, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.secondary, borderWidth: 1, borderColor: colors.border },
  upButton: { marginBottom: 8 },
  downButton: { marginTop: 8 },
  middleDirectionRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  okButton: { width: 78, height: 78, borderRadius: 39, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primary, borderWidth: 5, borderColor: colors.accent },
  okText: { color: colors.primaryForeground, fontSize: 15, fontWeight: '800', letterSpacing: 0.4 },
  utilityRow: { flexDirection: 'row', gap: 9, marginBottom: 16 },
  volumeChannelGrid: { flexDirection: 'row', gap: 10, marginBottom: 10 },
  stackControl: { flex: 1, gap: 8 },
  controlCaption: { color: colors.mutedForeground, fontSize: 10, fontWeight: '700', letterSpacing: 1.4, marginLeft: 4 },
  mediaRow: { flexDirection: 'row', gap: 9, marginTop: 6 },
  statusText: { color: colors.mutedForeground, fontSize: 12, textAlign: 'center', marginTop: 14 },
});