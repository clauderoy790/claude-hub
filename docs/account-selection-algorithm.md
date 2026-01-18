# Account Selection Algorithm

This document explains how Claude Hub selects the best account when launching a new terminal session.

## Overview

The algorithm aims to:
1. **Maximize available capacity** - prefer accounts with more remaining usage
2. **Spread usage evenly** - avoid stacking multiple terminals on the same account
3. **Minimize wasted capacity** - use accounts that reset sooner before their capacity expires

## Algorithm Steps

### 1. Filter Candidates

- Exclude accounts with API errors
- Exclude accounts explicitly excluded (e.g., when switching away from current account)
- **Exclude accounts at 100% session usage** (rate-limited) - these cannot be used until reset

### 2. Calculate Base Score

Each account gets a base score combining session and weekly capacity:

```
baseScore = (sessionRemaining × 0.6) + (weeklyRemaining × 0.4)
```

- `sessionRemaining`: 0-100% of 5-hour session capacity left
- `weeklyRemaining`: 0-100% of 7-day capacity left
- Session is weighted higher (60%) because hitting the session limit blocks usage immediately

**Example:**
| Account | Session Left | Weekly Left | Base Score |
|---------|--------------|-------------|------------|
| cc      | 88%          | 79%         | 88×0.6 + 79×0.4 = **84.4** |
| cc2     | 100%         | 62%         | 100×0.6 + 62×0.4 = **84.8** |
| cc3     | 50%          | 54%         | 50×0.6 + 54×0.4 = **51.6** |

### 3. Apply Penalties

**Active Session Penalty (-15 points)**

If the account is currently being used by another terminal, subtract 15 points. This prevents stacking both terminals on the same account.

**Last Used Penalty (-5 points)**

If the account was the last one selected, subtract 5 points. This encourages round-robin behavior when scores are similar.

### 4. Apply Reset Time Bonuses

Two bonuses prioritize accounts whose capacity expires sooner ("use it or lose it"):

**Session Reset Bonus (5-hour window):**
```
sessionResetBonus = (24 - hoursUntilSessionReset) × 0.5
```
- Max bonus: ~12 points (when session resets very soon)
- Helps use up session capacity before it resets

**Weekly Reset Bonus (7-day window):**
```
weeklyResetBonus = (7 - daysUntilWeeklyReset) × 2.5
```
- Max bonus: ~17.5 points (when weekly resets very soon)
- **This is the key to spreading usage** - accounts with weekly reset coming sooner get significant priority
- An account with 57% remaining but resetting in 3 days is more urgent than one with 79% remaining but resetting in 6 days

**Example weekly reset bonus:**
| Account | Weekly Resets In | Bonus |
|---------|------------------|-------|
| cc      | 6.5 days         | (7 - 6.5) × 2.5 = **+1.25** |
| cc2     | 3.5 days         | (7 - 3.5) × 2.5 = **+8.75** |

### 5. Final Score

```
adjustedScore = baseScore
              - activePenalty
              - lastUsedPenalty
              + sessionResetBonus
              + weeklyResetBonus
```

The account with the highest adjusted score is selected.

## Example Scenario

You have one terminal open on `cc3`.

**API Data:**
| Account | Session Left | Weekly Left | Session Resets | Weekly Resets |
|---------|--------------|-------------|----------------|---------------|
| cc      | 88%          | 79%         | 3h 20m         | 6d 12h        |
| cc2     | 61%          | 57%         | 3h 20m         | 3d 13h        |
| cc3     | 100%         | 54%         | 4h 20m         | 1d 20h        |

**Which should be "best" to switch to: cc or cc2?**

**Score Calculation (cc3 is current, so excluded):**

| Account | Base Score | Session Bonus | Weekly Bonus | Active? | Last? | Final |
|---------|------------|---------------|--------------|---------|-------|-------|
| cc      | 84.4       | +10.4         | +1.25        | No      | No    | **96.1** |
| cc2     | 59.4       | +10.4         | +8.75        | No      | No    | **78.5** |

**Wait, cc still wins?** Yes, but the gap closed from 25 points to 17.6 points. The weekly bonus helps but cc's raw capacity advantage is significant.

**When does cc2 win?** If cc had an active session (-15) or was last used (-5), cc2 would be closer or win:
- cc with active session: 96.1 - 15 = 81.1 → cc2 (78.5) still loses but very close
- cc with active + last used: 96.1 - 20 = 76.1 → cc2 (78.5) **wins**

**Result:** The weekly bonus makes accounts with expiring capacity more competitive, and combined with penalties, ensures better spreading.

## Rate-Limited Accounts

If ALL accounts are at 100% session usage (rate-limited), the algorithm picks the one that resets soonest. This minimizes wait time.

## State File

Session tracking is stored in `~/.claude-hub/state.json`:

```json
{
  "lastUsedAccount": "cc",
  "lastUsedAt": "2024-01-30T10:30:00Z",
  "activeSessions": [
    {
      "account": "cc",
      "pid": 12345,
      "startedAt": "2024-01-30T10:30:00Z"
    }
  ]
}
```

- **activeSessions**: Tracks which accounts have running terminals (by PID)
- **lastUsedAccount**: The most recently selected account
- Stale sessions (dead PIDs) are automatically cleaned up

## Configuration Constants

All tunable parameters are in `src/usage/selector.ts`:

| Constant | Default | Description |
|----------|---------|-------------|
| `WEIGHT_SESSION` | 0.6 | Weight for session remaining in base score |
| `WEIGHT_WEEKLY` | 0.4 | Weight for weekly remaining in base score |
| `PENALTY_ACTIVE_SESSION` | 15 | Points subtracted if account has active terminal |
| `PENALTY_LAST_USED` | 5 | Points subtracted if account was last selected |
| `BONUS_PER_HOUR_CLOSER_SESSION_RESET` | 0.5 | Bonus per hour closer to session reset (max ~12 pts) |
| `MAX_SESSION_RESET_HOURS_FOR_BONUS` | 24 | Cap for session reset bonus calculation |
| `BONUS_PER_DAY_CLOSER_WEEKLY_RESET` | 2.5 | Bonus per day closer to weekly reset (max ~17.5 pts) |
| `MAX_WEEKLY_RESET_DAYS_FOR_BONUS` | 7 | Cap for weekly reset bonus calculation |

## Potential Future Improvements

### Selection Counts
Track how many times each account was selected over time. If one account is consistently picked more often, add a balancing penalty.

```json
{
  "selectionCounts": {
    "cc": 45,
    "cc2": 38,
    "cc3": 22
  },
  "countsResetAt": "2024-01-27T00:00:00Z"
}
```

### Session Duration Tracking
Track how long each session lasts. A 4-hour session consumes more than a 10-minute session, so weight the "last used" penalty accordingly.

### Smarter Threshold
Instead of fixed penalties, dynamically adjust based on how close the scores are. If accounts are within 5% of each other, spread more aggressively. If one is clearly better, use it regardless.

### Cost-Aware Selection
If extra usage billing is enabled, factor in cost. Prefer accounts that won't incur extra charges.
