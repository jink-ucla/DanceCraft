import { useEffect, useState } from 'react'

export interface AppSettings {
  selectedDeviceId: string
  scoringSensitivity: 'easy' | 'normal' | 'hard'
  mirrorMode: boolean
}

const SETTINGS_KEY = 'groovy_settings'

export function loadSettings(): AppSettings {
  const stored = localStorage.getItem(SETTINGS_KEY)
  if (stored) {
    return JSON.parse(stored)
  }
  return {
    selectedDeviceId: '',
    scoringSensitivity: 'normal',
    mirrorMode: true,
  }
}

export function saveSettings(settings: AppSettings): void {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
}

interface SettingsProps {
  onBack: () => void
}

interface WebcamDevice {
  deviceId: string
  label: string
}

export function Settings({ onBack }: SettingsProps) {
  const [settings, setSettings] = useState<AppSettings>(loadSettings)
  const [devices, setDevices] = useState<WebcamDevice[]>([])

  useEffect(() => {
    async function loadDevices() {
      try {
        // Request permission first to get labeled devices
        await navigator.mediaDevices.getUserMedia({ video: true })
        const allDevices = await navigator.mediaDevices.enumerateDevices()
        const videoDevices = allDevices
          .filter((d) => d.kind === 'videoinput')
          .map((d) => ({
            deviceId: d.deviceId,
            label: d.label || `Camera ${d.deviceId.slice(0, 8)}`,
          }))
        setDevices(videoDevices)
      } catch {
        // Camera not available — list will be empty
      }
    }
    loadDevices()
  }, [])

  function update(partial: Partial<AppSettings>) {
    const next = { ...settings, ...partial }
    setSettings(next)
    saveSettings(next)
  }

  return (
    <div className="settings-screen">
      <h2>Settings</h2>

      <div className="settings-section">
        <label className="settings-label">Camera</label>
        <select
          className="settings-select"
          value={settings.selectedDeviceId}
          onChange={(e) => update({ selectedDeviceId: e.target.value })}
        >
          <option value="">Default Camera</option>
          {devices.map((d) => (
            <option key={d.deviceId} value={d.deviceId}>
              {d.label}
            </option>
          ))}
        </select>
      </div>

      <div className="settings-section">
        <label className="settings-label">Scoring Sensitivity</label>
        <div className="settings-radio-group">
          {(['easy', 'normal', 'hard'] as const).map((level) => (
            <label key={level} className="settings-radio">
              <input
                type="radio"
                name="sensitivity"
                value={level}
                checked={settings.scoringSensitivity === level}
                onChange={() => update({ scoringSensitivity: level })}
              />
              {level.charAt(0).toUpperCase() + level.slice(1)}
            </label>
          ))}
        </div>
      </div>

      <div className="settings-section">
        <label className="settings-label">
          <input
            type="checkbox"
            checked={settings.mirrorMode}
            onChange={(e) => update({ mirrorMode: e.target.checked })}
          />
          Mirror mode (flip webcam horizontally)
        </label>
      </div>

      <button className="settings-back-btn" onClick={onBack}>
        Back
      </button>
    </div>
  )
}
