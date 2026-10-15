import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '../data');
const SETTINGS_FILE = join(DATA_DIR, 'settings.json');

if (!existsSync(DATA_DIR)) {
  mkdirSync(DATA_DIR, { recursive: true });
}

function loadSettings() {
  if (!existsSync(SETTINGS_FILE)) return {};
  try {
    return JSON.parse(readFileSync(SETTINGS_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function saveSettings(data) {
  writeFileSync(SETTINGS_FILE, JSON.stringify(data, null, 2), 'utf8');
}

export function getAllowedChannels(guildId) {
  const settings = loadSettings();
  return settings[guildId]?.allowedChannels || [];
}

export function setAllowedChannels(guildId, channelIds) {
  const settings = loadSettings();
  if (!settings[guildId]) settings[guildId] = {};
  settings[guildId].allowedChannels = channelIds;
  saveSettings(settings);
}

export function addAllowedChannel(guildId, channelId) {
  const settings = loadSettings();
  if (!settings[guildId]) settings[guildId] = {};
  if (!settings[guildId].allowedChannels) settings[guildId].allowedChannels = [];
  if (!settings[guildId].allowedChannels.includes(channelId)) {
    settings[guildId].allowedChannels.push(channelId);
    saveSettings(settings);
  }
}

export function removeAllowedChannel(guildId, channelId) {
  const settings = loadSettings();
  if (!settings[guildId]?.allowedChannels) return;
  settings[guildId].allowedChannels = settings[guildId].allowedChannels.filter(id => id !== channelId);
  saveSettings(settings);
}

export function clearAllowedChannels(guildId) {
  const settings = loadSettings();
  if (settings[guildId]) {
    settings[guildId].allowedChannels = [];
    saveSettings(settings);
  }
}

export function isChannelAllowed(guildId, channelId) {
  const allowed = getAllowedChannels(guildId);
  if (allowed.length === 0) return true;
  return allowed.includes(channelId);
}
