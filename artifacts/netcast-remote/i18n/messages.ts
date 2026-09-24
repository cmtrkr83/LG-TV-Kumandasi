export type Language = 'tr' | 'en'

export const trMessages = {
  'app.title': 'TV kumandanız.',
  'language.selector': 'Dil seçin',
  'language.turkish': 'Türkçe',
  'language.english': 'İngilizce',
  'setup.title': 'TV’ye bağlanın',
  'setup.body':
    'Telefon ve LG NetCast TV aynı Wi-Fi ağında olmalı. Önce ağda otomatik arayın veya IP adresini elle girin.',
  'setup.scan': 'Ağdaki TV’leri tara',
  'setup.scanning': 'Ağ taranıyor…',
  'setup.discoveryTitle': 'BULUNAN TV’LER',
  'setup.discoveryStatus':
    '{online}/{total} çevrimiçi · canlı güncellemeler açık',
  'device.online': 'Çevrimiçi',
  'device.offline': 'Çevrimdışı',
  'setup.manual': 'VEYA IP ADRESİYLE DEVAM EDİN',
  'setup.web':
    'Web üzerinde eşleştirme çalışmaz. Fiziksel Android veya iOS cihaz kullanın.',
  'setup.ipLabel': 'TV IP ADRESİ',
  'setup.pairingLabel': 'TV EŞLEŞTİRME KODU',
  'setup.pairingPlaceholder': 'TV ekranındaki 6 haneli kod',
  'setup.pair': 'TV’yi eşleştir',
  'setup.requestCode': 'TV’den kod iste',
  'connected.disconnect': 'Bağlantıyı kaldır',
  'connected.touchNote': 'İmleç görünmüyorsa parmağınızı panelde sürükleyin.',
  'page.touchpad': 'Fare',
  'page.remote': 'Kumanda',
  'page.numbers': 'Sayılar',
  'page.goTo': '{page} sayfasına git',
  'section.touchpad': 'FARE',
  'section.numbers': 'RAKAMLAR',
  'section.channel': 'KANAL',
  'section.media': 'MEDYA',
  'section.volume': 'SES',
  'section.channelShort': 'KANAL',
  'a11y.holdRepeat': '{label} (basılı tutunca tekrarlar)',
  'a11y.holdRepeatHint': 'Basılı tutunca tekrarlar',
  'touchpad.accessibility':
    'Fare paneli. Sürükleyince imleç hareket eder, dokununca tıklanır.',
  'touchpad.active': 'Hareket ediyor…',
  'touchpad.idle': 'Sürükle: imleci hareket ettir · Dokun: tıkla',
  'command.digit': 'Rakam {digit}',
  'command.dash': 'Tire',
  'command.favorite': 'Favori',
  'command.previousChannel': 'Önceki Kanal',
  'command.channelList': 'Kanal Listesi',
  'command.guide': 'Rehber',
  'command.power': 'Güç',
  'command.quickMenu': 'Hızlı Menü',
  'command.input': 'Giriş',
  'command.apps': 'Apps',
  'command.volumeUp': 'Ses artır',
  'command.volumeDown': 'Ses azalt',
  'command.channelUp': 'Kanal artır',
  'command.channelDown': 'Kanal azalt',
  'command.up': 'Yukarı',
  'command.left': 'Sol',
  'command.ok': 'Tamam',
  'command.right': 'Sağ',
  'command.down': 'Aşağı',
  'command.back': 'Geri',
  'command.home': 'Ana Menü',
  'command.menu': 'Menü',
  'command.exit': 'Çıkış',
  'command.mute': 'Sessiz',
  'command.info': 'Bilgi',
  'command.rewind': 'Geri sar',
  'command.play': 'Oynat',
  'command.pause': 'Duraklat',
  'command.stop': 'Durdur',
  'command.fastForward': 'İleri sar',
  'command.red': 'Kırmızı',
  'command.green': 'Yeşil',
  'command.yellow': 'Sarı',
  'command.blue': 'Mavi',
  'command.click': 'Tıkla',
  'command.scrollUp': 'Kaydır ↑',
  'command.scrollDown': 'Kaydır ↓',
  'status.initial': 'TV IP adresini girerek başlayın.',
  'status.mouseBackpressure':
    'Fare hareketi kuyruğu dolu; bazı hareketler birleştirildi.',
  'status.mouseSending': 'Fare hareketi gönderiliyor…',
  'status.sessionExpired': 'TV oturumu sona erdi. Yeni eşleştirme yapın.',
  'status.pairingWaiting': 'Yeni eşleştirme bekleniyor.',
  'status.sessionCleanupFailed': 'Oturum kapatıldı; kayıt temizlenemedi.',
  'status.webPairingUnavailable':
    'Web üzerinde TV eşleştirme yapılamaz. Fiziksel Android veya iOS cihaz kullanın.',
  'status.physicalDeviceRequired': 'Fiziksel cihaz gerekli.',
  'status.localNetworkRequired': 'Yerel ağ bağlantısı gerekli.',
  'status.manualConnectionWaiting': 'Elle bağlantı bekleniyor.',
  'status.storageReadFailed': 'Kayıtlı bağlantı yüklenemedi.',
  'status.storedConnectionInvalid':
    'Eski kayıt geçersiz. TV ile yeniden eşleştirin.',
  'status.storedConnectionCleanupFailed':
    'Eski kayıt temizlenemedi; yeni eşleştirme yapabilirsiniz.',
  'status.storedTvSearching': 'Kayıtlı TV aranıyor…',
  'status.connectionReadyWarning':
    'Bağlantı hazır; kayıtlı bağlantı bilgileriyle ilgili bir uyarı var.',
  'status.connectionReady': 'Bağlantı hazır',
  'status.invalidPairingKey': 'Yeni eşleştirme bekleniyor.',
  'status.invalidPairingCleanupFailed':
    'Geçersiz kayıt temizlenemedi; yeni eşleştirme yapabilirsiniz.',
  'status.storedTvUnreachable':
    'Kayıtlı TV’ye ulaşılamadı; yeniden deneyebilirsiniz.',
  'status.scanning': 'Ağdaki NetCast TV’ler aranıyor…',
  'status.scanSsdpFallback':
    'SSDP yanıt vermedi; yakın IP adresleri sınırlı olarak kontrol ediliyor…',
  'status.scanFound': '{count} TV bulundu. Eşleştirmek için birini seçin.',
  'status.scanFound_one': '{count} TV bulundu. Eşleştirmek için birini seçin.',
  'status.scanFound_other':
    '{count} TV bulundu. Eşleştirmek için birini seçin.',
  'status.scanComplete': 'Tarama tamamlandı.',
  'status.scanTimeout': 'Tarama zaman aşımına uğradı.',
  'status.selectedTv':
    '{name} seçildi. TV ekranında kod istemek için devam edin.',
  'status.mouseQueueFull': 'Fare hareketi kuyruğu dolu.',
  'status.command.sent': '{label} komutu TV’ye gönderildi',
  'status.touchClickSent': 'Tık gönderildi',
  'status.scrollUpSent': 'Yukarı kaydırıldı',
  'status.scrollDownSent': 'Aşağı kaydırıldı',
  'status.disconnected': 'Bağlantı kaldırıldı.',
  'status.disconnectCleanupFailed': 'Bağlantı kaldırıldı.',
  'status.storageSaveFailed':
    'Bağlantı hazır; bağlantı bilgileri kaydedilemedi.',
  'status.storageReadWarning':
    'Bağlantı hazır; kayıtlı TV bilgileri okunamadı.',
  'status.storageCleanupWarning': 'Bağlantı hazır; eski kayıt temizlenemedi.',
  'status.storageSaveWarning':
    'Bağlantı hazır; bağlantı bilgileri kaydedilemedi.',
  'status.pairingCodeRequested': 'TV ekranındaki 6 haneli kodu girin.',
  'error.commandQueueFull':
    'TV isteği kuyruğu dolu; kısa süre sonra tekrar deneyin.',
  'error.commandUnsupported': 'TV bu komutu desteklemiyor.',
  'error.commandTransient': 'TV geçici olarak yanıt vermiyor.',
  'error.commandFailed': 'TV isteği gönderilemedi.',
  'error.storageSave':
    'TV bağlantı bilgileri bu cihazda kaydedilemedi; mevcut oturumu kullanmaya devam edebilirsiniz.',
  'error.storageRead':
    'Kayıtlı TV bağlantısı okunamadı; manuel IP ile devam edebilirsiniz.',
  'error.storageCleanup':
    'Eski kayıt temizlenemedi; mevcut oturumu kullanmaya devam edebilirsiniz.',
  'error.storageReadGeneric': 'TV bağlantı bilgileri okunamadı.',
  'error.sessionExpired': 'TV oturumu sona erdi. Yeni eşleştirme yapın.',
  'error.sessionCleanupFailed': 'Oturum kapatıldı; kayıt temizlenemedi.',
  'error.webPairingUnavailable':
    'Web üzerinde TV eşleştirme yapılamaz. Fiziksel Android veya iOS cihaz kullanın.',
  'error.storedConnectionInvalid':
    'Eski kayıt geçersiz. TV ile yeniden eşleştirin.',
  'error.storedConnectionCleanupFailed':
    'Eski kayıt temizlenemedi; yeni eşleştirme yapabilirsiniz.',
  'error.invalidPairingKey':
    'Kayıtlı eşleştirme anahtarı geçersiz. TV ile yeniden eşleştirin.',
  'error.invalidPairingCleanupFailed':
    'Geçersiz kayıt temizlenemedi; yeni eşleştirme yapabilirsiniz.',
  'error.storedTvUnreachable':
    'Kayıtlı TV’ye ulaşılamadı; yeniden deneyebilirsiniz.',
  'error.scanWeb':
    'Ağ taraması ve eşleştirme web tarayıcısında çalışmaz. Fiziksel Android veya iOS cihaz kullanın.',
  'error.noWifi':
    'Wi-Fi bağlantısı bulunamadı. Telefonu TV ile aynı yerel ağa bağlayın.',
  'error.noLocalSubnet':
    'Güvenli bir yerel ağ aralığı bulunamadı. TV IP adresini elle girebilirsiniz.',
  'error.scanFailed':
    'Yerel ağ taraması tamamlanamadı. Yerel ağ izinlerini ve Wi-Fi bağlantısını kontrol edin.',
  'error.scanTimeout': 'Tarama zaman aşımına uğradı.',
  'error.noTvFound':
    'NetCast TV bulunamadı. Yakın IP adresleri tarandı; TV IP adresini elle girebilirsiniz.',
  'error.hostRequired':
    'Bir TV seçin veya yerel IP adresini girin. Örnek: 192.168.1.42',
  'error.pairingCodeInvalid':
    'Kod doğrulanamadı. TV’de görünen kodu eksiksiz girin.',
  'error.pairingUnsupported': 'TV eşleştirme isteğini desteklemiyor.',
  'error.pairingNetwork':
    'TV’ye ulaşılamadı. Aynı Wi-Fi ağında olduğunuzu ve NetCast ağ bağlantısının açık olduğunu kontrol edin.',
  'error.disconnectCleanup':
    'Bağlantı kaldırıldı; kayıt bilgileri temizlenemedi.',
  'error.scanComplete': 'Tarama tamamlandı.',
  'notFound.title': 'Sayfa bulunamadı',
  'notFound.message': 'Bu sayfa mevcut değil.',
  'notFound.link': 'Ana sayfaya dön',
  'error.fallbackTitle': 'Bir şeyler ters gitti',
  'error.fallbackMessage': 'Devam etmek için uygulamayı yeniden yükleyin.',
  'error.tryAgain': 'Tekrar dene',
  'error.viewDetails': 'Hata ayrıntılarını görüntüle',
  'error.details': 'Hata ayrıntıları',
  'error.closeDetails': 'Hata ayrıntılarını kapat',
  'error.errorLabel': 'Hata',
  'error.stackTrace': 'Yığın izi',
  'error.restartFailed': 'Uygulama yeniden başlatılamadı',
} as const

export type TranslationKey = keyof typeof trMessages
export type MessageKey = TranslationKey
export type MessageParam = string | number
export interface MessageParams {
  [key: string]: MessageParam | MessageParams | undefined
}
export type MessageDictionary = Record<TranslationKey, string>
export type MessageDescriptor = {
  key: TranslationKey
  params?: MessageParams
}
export type Translate = {
  (key: string, params?: MessageParams): string
  (descriptor: MessageDescriptor): string
}

export const enMessages: MessageDictionary = {
  'app.title': 'Your TV remote.',
  'language.selector': 'Choose language',
  'language.turkish': 'Turkish',
  'language.english': 'English',
  'setup.title': 'Connect to your TV',
  'setup.body':
    'Your phone and LG NetCast TV must be on the same Wi-Fi network. Search automatically or enter an IP address manually.',
  'setup.scan': 'Scan for TVs',
  'setup.scanning': 'Scanning network…',
  'setup.discoveryTitle': 'FOUND TVS',
  'setup.discoveryStatus': '{online}/{total} online · live updates enabled',
  'device.online': 'Online',
  'device.offline': 'Offline',
  'setup.manual': 'OR CONTINUE WITH AN IP ADDRESS',
  'setup.web':
    'Pairing does not work on the web. Use a physical Android or iOS device.',
  'setup.ipLabel': 'TV IP ADDRESS',
  'setup.pairingLabel': 'TV PAIRING CODE',
  'setup.pairingPlaceholder': '6-digit code on the TV',
  'setup.pair': 'Pair with TV',
  'setup.requestCode': 'Request code from TV',
  'connected.disconnect': 'Disconnect',
  'connected.touchNote':
    'If the pointer is not visible, drag your finger on the panel.',
  'page.touchpad': 'Pointer',
  'page.remote': 'Remote',
  'page.numbers': 'Numbers',
  'page.goTo': 'Go to {page} page',
  'section.touchpad': 'POINTER',
  'section.numbers': 'NUMBERS',
  'section.channel': 'CHANNEL',
  'section.media': 'MEDIA',
  'section.volume': 'VOLUME',
  'section.channelShort': 'CHANNEL',
  'a11y.holdRepeat': '{label} (hold to repeat)',
  'a11y.holdRepeatHint': 'Hold to repeat',
  'touchpad.accessibility':
    'Pointer pad. Drag to move the pointer and tap to click.',
  'touchpad.active': 'Moving pointer…',
  'touchpad.idle': 'Drag to move the pointer · Tap to click',
  'command.digit': 'Digit {digit}',
  'command.dash': 'Dash',
  'command.favorite': 'Favorite',
  'command.previousChannel': 'Previous channel',
  'command.channelList': 'Channel list',
  'command.guide': 'Guide',
  'command.power': 'Power',
  'command.quickMenu': 'Quick menu',
  'command.input': 'Input',
  'command.apps': 'Apps',
  'command.volumeUp': 'Volume up',
  'command.volumeDown': 'Volume down',
  'command.channelUp': 'Channel up',
  'command.channelDown': 'Channel down',
  'command.up': 'Up',
  'command.left': 'Left',
  'command.ok': 'OK',
  'command.right': 'Right',
  'command.down': 'Down',
  'command.back': 'Back',
  'command.home': 'Home',
  'command.menu': 'Menu',
  'command.exit': 'Exit',
  'command.mute': 'Mute',
  'command.info': 'Info',
  'command.rewind': 'Rewind',
  'command.play': 'Play',
  'command.pause': 'Pause',
  'command.stop': 'Stop',
  'command.fastForward': 'Fast forward',
  'command.red': 'Red',
  'command.green': 'Green',
  'command.yellow': 'Yellow',
  'command.blue': 'Blue',
  'command.click': 'Click',
  'command.scrollUp': 'Scroll ↑',
  'command.scrollDown': 'Scroll ↓',
  'status.initial': 'Start by entering a TV IP address.',
  'status.mouseBackpressure':
    'The pointer movement queue is full; some movements were combined.',
  'status.mouseSending': 'Sending pointer movement…',
  'status.sessionExpired': 'The TV session ended. Pair again.',
  'status.pairingWaiting': 'Waiting for a new pairing.',
  'status.sessionCleanupFailed':
    'Session closed; the saved record could not be cleared.',
  'status.webPairingUnavailable':
    'TV pairing is not available on the web. Use a physical Android or iOS device.',
  'status.physicalDeviceRequired': 'A physical device is required.',
  'status.localNetworkRequired': 'A local network connection is required.',
  'status.manualConnectionWaiting': 'Waiting for a manual connection.',
  'status.storageReadFailed': 'The saved connection could not be loaded.',
  'status.storedConnectionInvalid':
    'The old record is invalid. Pair with the TV again.',
  'status.storedConnectionCleanupFailed':
    'The old record could not be cleared; you can pair again.',
  'status.storedTvSearching': 'Searching for the saved TV…',
  'status.connectionReadyWarning':
    'Connected, but the saved TV details need attention.',
  'status.connectionReady': 'Connected',
  'status.invalidPairingKey': 'Waiting for a new pairing.',
  'status.invalidPairingCleanupFailed':
    'The invalid record could not be cleared; you can pair again.',
  'status.storedTvUnreachable': 'The saved TV could not be reached; try again.',
  'status.scanning': 'Searching for NetCast TVs on the network…',
  'status.scanSsdpFallback':
    'SSDP did not respond; checking nearby IP addresses…',
  'status.scanFound': '{count} TV found. Select one to pair.',
  'status.scanFound_one': '{count} TV found. Select one to pair.',
  'status.scanFound_other': '{count} TVs found. Select one to pair.',
  'status.scanComplete': 'Scan complete.',
  'status.scanTimeout': 'The scan timed out.',
  'status.selectedTv': '{name} selected. Continue to request a code on the TV.',
  'status.mouseQueueFull': 'The pointer movement queue is full.',
  'status.command.sent': '{label} command sent to the TV',
  'status.touchClickSent': 'Click sent',
  'status.scrollUpSent': 'Scrolled up',
  'status.scrollDownSent': 'Scrolled down',
  'status.disconnected': 'Disconnected.',
  'status.disconnectCleanupFailed': 'Disconnected.',
  'status.storageSaveFailed':
    'Connected, but the connection details could not be saved.',
  'status.storageReadWarning':
    'Connected, but the saved TV details could not be read.',
  'status.storageCleanupWarning':
    'Connected, but the old saved record could not be cleared.',
  'status.storageSaveWarning':
    'Connected, but the connection details could not be saved.',
  'status.pairingCodeRequested': 'Enter the 6-digit code shown on the TV.',
  'error.commandQueueFull': 'The TV request queue is full; try again shortly.',
  'error.commandUnsupported': 'The TV does not support this command.',
  'error.commandTransient': 'The TV is temporarily not responding.',
  'error.commandFailed': 'The TV request could not be sent.',
  'error.storageSave':
    'The TV connection details could not be saved on this device; you can keep using the current session.',
  'error.storageRead':
    'The saved TV connection could not be read; continue with a manual IP address.',
  'error.storageCleanup':
    'The old saved record could not be cleared; you can keep using the current session.',
  'error.storageReadGeneric':
    'The TV connection information could not be read.',
  'error.sessionExpired': 'The TV session ended. Pair again.',
  'error.sessionCleanupFailed':
    'Session closed; the saved record could not be cleared.',
  'error.webPairingUnavailable':
    'TV pairing is not available on the web. Use a physical Android or iOS device.',
  'error.storedConnectionInvalid':
    'The old record is invalid. Pair with the TV again.',
  'error.storedConnectionCleanupFailed':
    'The old record could not be cleared; you can pair again.',
  'error.invalidPairingKey':
    'The saved pairing key is invalid. Pair with the TV again.',
  'error.invalidPairingCleanupFailed':
    'The invalid record could not be cleared; you can pair again.',
  'error.storedTvUnreachable': 'The saved TV could not be reached; try again.',
  'error.scanWeb':
    'Network scanning and pairing do not work in a web browser. Use a physical Android or iOS device.',
  'error.noWifi':
    'No Wi-Fi connection was found. Connect the phone to the same local network as the TV.',
  'error.noLocalSubnet':
    'A safe local network range could not be found. Enter the TV IP address manually.',
  'error.scanFailed':
    'The local network scan could not be completed. Check local network permissions and the Wi-Fi connection.',
  'error.scanTimeout': 'The scan timed out.',
  'error.noTvFound':
    'No NetCast TV was found. Nearby IP addresses were scanned; enter the TV IP address manually.',
  'error.hostRequired':
    'Select a TV or enter a local IP address. Example: 192.168.1.42',
  'error.pairingCodeInvalid':
    'The code could not be verified. Enter the complete code shown on the TV.',
  'error.pairingUnsupported': 'The TV does not support the pairing request.',
  'error.pairingNetwork':
    'The TV could not be reached. Check that you are on the same Wi-Fi network and that NetCast network access is enabled.',
  'error.disconnectCleanup':
    'Disconnected; the saved record could not be cleared.',
  'error.scanComplete': 'Scan complete.',
  'notFound.title': 'Page not found',
  'notFound.message': 'This page does not exist.',
  'notFound.link': 'Back to home',
  'error.fallbackTitle': 'Something went wrong',
  'error.fallbackMessage': 'Please reload the app to continue.',
  'error.tryAgain': 'Try Again',
  'error.viewDetails': 'View error details',
  'error.details': 'Error Details',
  'error.closeDetails': 'Close error details',
  'error.errorLabel': 'Error',
  'error.stackTrace': 'Stack Trace',
  'error.restartFailed': 'Failed to restart app',
}

export const translations: Record<Language, MessageDictionary> = {
  tr: trMessages,
  en: enMessages,
}

export const tr = trMessages
export const en = enMessages
export const messages = translations
export const dictionaries = translations
export const DEFAULT_LANGUAGE: Language = 'tr'

export function isLanguage(value: unknown): value is Language {
  return value === 'tr' || value === 'en'
}

export function getPluralForm(
  language: Language,
  count: number,
): 'one' | 'other' {
  return language === 'en' && count === 1
    ? 'one'
    : count === 1
      ? 'one'
      : 'other'
}

export function pluralize(
  language: Language,
  count: number,
  one: string,
  other: string,
): string {
  return getPluralForm(language, count) === 'one' ? one : other
}

function readParam(
  params: MessageParams | undefined,
  path: string,
): MessageParam | MessageParams | undefined {
  if (!params) return undefined
  let value: MessageParam | MessageParams | undefined = params
  for (const segment of path.split('.')) {
    if (value === undefined || value === null || typeof value !== 'object') {
      return undefined
    }
    value = value[segment]
  }
  return value
}

export function interpolate(
  template: string,
  params: MessageParams = {},
): string {
  return template.replace(/\{([^{}]+)\}/g, (placeholder, name: string) => {
    const value = readParam(params, name)
    if (value === undefined || value === null || typeof value === 'object') {
      return placeholder
    }
    if (typeof value === 'number' && !Number.isFinite(value)) return placeholder
    return String(value)
  })
}

function countFromParams(params?: MessageParams): number | undefined {
  const value = params?.count
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (
    typeof value === 'string' &&
    value.trim() !== '' &&
    Number.isFinite(Number(value))
  ) {
    return Number(value)
  }
  return undefined
}

function resolveParams(
  language: Language,
  params?: MessageParams,
): MessageParams | undefined {
  if (!params) return undefined
  const resolved = { ...params }
  if (
    Object.prototype.hasOwnProperty.call(params, 'count') &&
    countFromParams(params) === undefined
  ) {
    resolved.count = undefined
  }
  if (typeof params.labelKey === 'string') {
    resolved.label = translate(
      language,
      params.labelKey,
      params.labelParams as MessageParams | undefined,
    )
  }
  return resolved
}

function findTemplate(
  language: Language,
  key: string,
  params?: MessageParams,
): string | undefined {
  const dictionary = translations[language]
  const count = countFromParams(params)
  if (count !== undefined) {
    const variantKey =
      `${key}_${getPluralForm(language, count)}` as TranslationKey
    if (variantKey in dictionary) return dictionary[variantKey]
  }
  const dictionaryKey = key as TranslationKey
  if (dictionaryKey in dictionary) return dictionary[dictionaryKey]
  if (dictionaryKey in trMessages) return trMessages[dictionaryKey]
  return undefined
}

export function translate(
  language: Language,
  key: string,
  params?: MessageParams,
): string
export function translate(
  language: Language,
  descriptor: MessageDescriptor,
): string
export function translate(
  language: Language,
  keyOrDescriptor: string | MessageDescriptor,
  params?: MessageParams,
): string {
  const key =
    typeof keyOrDescriptor === 'string' ? keyOrDescriptor : keyOrDescriptor.key
  const resolvedParams = resolveParams(
    language,
    typeof keyOrDescriptor === 'string' ? params : keyOrDescriptor.params,
  )
  const template = findTemplate(language, key, resolvedParams)
  return interpolate(template ?? key, resolvedParams)
}

export function formatMessage(
  language: Language,
  descriptor: MessageDescriptor,
): string {
  return translate(language, descriptor)
}
