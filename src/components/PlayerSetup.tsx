import { useRef } from 'react'
import { MAX_PLAYER_NAME_LENGTH } from '../storage/arena'
import type { ArenaPlayer } from '../storage/arena'
import { CrownIcon } from './Leaderboard'
import './Arena.css'

interface PlayerSetupProps {
  /** Draft values (controlled). Empty name = "Guest" when the dance starts. */
  name: string
  isHost: boolean
  onChange: (next: ArenaPlayer) => void
  /** "Next challenger": clear name + host flag for the next person in line. */
  onNextChallenger: () => void
  /** Optional "Score to beat" banner for the selected dance. */
  hostToBeat?: { name: string; score: number } | null
}

/**
 * Player identity fields shown inside the difficulty modal, above the
 * difficulty buttons. Picking a difficulty is what actually saves the player.
 */
export function PlayerSetup({ name, isHost, onChange, onNextChallenger, hostToBeat }: PlayerSetupProps) {
  const inputRef = useRef<HTMLInputElement>(null)

  return (
    <div className="player-setup">
      {hostToBeat && !isHost && (
        <div className="player-setup-challenge">
          <CrownIcon size={13} />
          <span>
            Score to beat: <strong>{hostToBeat.name}</strong> {Math.round(hostToBeat.score * 100)}%
          </span>
        </div>
      )}
      <label className="player-setup-label" htmlFor="player-setup-name">Who&apos;s dancing?</label>
      <input
        id="player-setup-name"
        ref={inputRef}
        className="player-setup-input"
        type="text"
        value={name}
        placeholder="Your name"
        maxLength={MAX_PLAYER_NAME_LENGTH}
        autoComplete="off"
        spellCheck={false}
        autoFocus
        onChange={(e) => onChange({ name: e.target.value, isHost })}
      />
      <div className="player-setup-row">
        <label className="player-setup-host">
          <input
            type="checkbox"
            checked={isHost}
            onChange={(e) => onChange({ name, isHost: e.target.checked })}
          />
          <span>I&apos;m the host — set the challenge</span>
        </label>
        <button
          type="button"
          className="player-setup-next"
          onClick={() => {
            onNextChallenger()
            inputRef.current?.focus()
          }}
        >
          Next challenger
        </button>
      </div>
    </div>
  )
}
