import type { MessageParams, TranslationKey } from './messages'

const fixedRemoteTestIds: Partial<Record<TranslationKey, string>> = {
  'command.dash': 'remote-dash',
  'command.favorite': 'remote-favorite',
  'command.previousChannel': 'remote-previous-channel',
  'command.channelList': 'remote-channel-list',
  'command.guide': 'remote-guide',
  'command.power': 'remote-power',
  'command.quickMenu': 'remote-quick-menu',
  'command.input': 'remote-input',
  'command.apps': 'remote-apps',
  'command.volumeUp': 'remote-volume-up',
  'command.volumeDown': 'remote-volume-down',
  'command.channelUp': 'remote-channel-up',
  'command.channelDown': 'remote-channel-down',
  'command.up': 'remote-yukari',
  'command.left': 'remote-sol',
  'command.ok': 'remote-tamam',
  'command.right': 'remote-sag',
  'command.down': 'remote-asagi',
  'command.back': 'remote-back',
  'command.home': 'remote-home',
  'command.menu': 'remote-menu',
  'command.exit': 'remote-exit',
  'command.mute': 'remote-mute',
  'command.info': 'remote-info',
  'command.rewind': 'remote-rewind',
  'command.play': 'remote-play',
  'command.pause': 'remote-pause',
  'command.stop': 'remote-stop',
  'command.fastForward': 'remote-fast-forward',
  'command.red': 'remote-red',
  'command.green': 'remote-green',
  'command.yellow': 'remote-yellow',
  'command.blue': 'remote-blue',
  'command.click': 'remote-click',
  'command.scrollUp': 'remote-scroll-up',
  'command.scrollDown': 'remote-scroll-down',
}

export function remoteTestID(
  labelKey: TranslationKey,
  params?: MessageParams,
): string {
  if (labelKey === 'command.digit')
    return `remote-sayi-${String(params?.digit ?? '')}`
  return (
    fixedRemoteTestIds[labelKey] ?? `remote-${labelKey.replace(/\./g, '-')}`
  )
}
