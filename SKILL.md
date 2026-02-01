---
name: sports-oracle
description: Verify sports game results (NBA, NFL, etc.) by querying TheSportsDB. Use when agents need to confirm game outcomes, scores, or winners for betting, prediction markets, or verification workflows. Returns structured data with confidence scores.
metadata:
  {
    "openclaw":
      {
        "requires": {},
        "install": [],
      },
  }
---

# Sports Verification Oracle

Verify sports game results with confidence scores. Built for agent-to-agent verification workflows.

## What It Does

- Queries TheSportsDB API for game results
- Returns structured data: winner, scores, teams, league
- Provides confidence score (0.75 base, 0.85 with opponent match)
- Handles natural language questions

## Usage

### Via Node.js

```javascript
const { askOracle } = require('{baseDir}/oracle.js');

// Natural language query
const result = await askOracle('Who won the Lakers game on 2026-01-19?');
console.log(result);
// {
//   verified: true,
//   confidence: 0.75,
//   result: {
//     homeTeam: "Los Angeles Lakers",
//     awayTeam: "Toronto Raptors",
//     homeScore: 110,
//     awayScore: 93,
//     winner: "Los Angeles Lakers",
//     finalScore: "110-93"
//   },
//   league: "NBA",
//   sources: ["thesportsdb"]
// }
```

### Via CLI

```bash
node {baseDir}/oracle.js "Who won the Lakers game yesterday?"
```

### Direct API

```javascript
const { verifyResult } = require('{baseDir}/oracle.js');

const result = await verifyResult({
  team: 'Lakers',
  date: '2026-01-19',
  opponent: 'Raptors'  // optional, increases confidence if matched
});
```

## Response Schema

| Field | Type | Description |
|-------|------|-------------|
| `verified` | boolean | Whether verification succeeded |
| `confidence` | number | 0.0-1.0 confidence score |
| `result.winner` | string | Winning team name |
| `result.homeTeam` | string | Home team |
| `result.awayTeam` | string | Away team |
| `result.homeScore` | number | Home team score |
| `result.awayScore` | number | Away team score |
| `result.finalScore` | string | "110-93" format |
| `league` | string | NBA, NFL, etc. |
| `sources` | array | Data sources queried |
| `timestamp` | string | ISO timestamp |

## Confidence Levels

| Score | Meaning |
|-------|---------|
| 0.75 | Single source verification |
| 0.85 | Single source + opponent match confirmed |
| 0.95+ | Multiple agreeing sources (planned) |

## Supported Queries

- "Who won the Lakers game yesterday?"
- "Did the Celtics beat the Heat on 2026-01-25?"
- "What was the score of the Warriors game on 2026-01-20?"
- Any team name + date combination

## Error Handling

```javascript
// Team not found
{ verified: false, error: 'team_not_found', confidence: 0 }

// No game on that date
{ verified: false, error: 'event_not_found_on_date', confidence: 0 }

// Could not parse question
{ verified: false, error: 'could_not_parse_team_name', confidence: 0 }
```

## Data Source

- **TheSportsDB** - Free tier, 100 req/min, 5-10 min delay after games

## Monetization

This oracle is designed for Nevermined micropayments:
- Per-query pricing: $0.001-0.01 per verification
- Outcome-based: Higher fee for high-confidence results
- Subscription: Unlimited queries for fixed monthly fee

## Roadmap

1. [x] TheSportsDB integration
2. [ ] Add BALLDONTLIE as second source (0.90+ confidence)
3. [ ] Nevermined payment integration
4. [ ] ClawHub publication
5. [ ] Moltbook deployment
