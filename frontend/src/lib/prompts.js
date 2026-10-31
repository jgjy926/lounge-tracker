// The prompts the user hands to any AI chat. Single source of truth: the Import
// screen's "Copy prompt" copies these, and docs/ai-prompts.md is generated from them.
export const RULES_SCHEMA = 'lounge-rules-import/v1'
export const SPEND_SCHEMA = 'lounge-spend-import/v1'
export const LOUNGES_SCHEMA = 'lounge-directory-import/v1'
export const TRIPS_SCHEMA = 'lounge-trip-import/v1'

const SPEND_TYPE_LIST = 'instalment, balance_transfer, cash_advance, fee, ewallet, government, insurance, utilities'

const RULES_BODY = `You are a careful terms-and-conditions analyst for Malaysian credit-card airport lounge benefits. I will give you the Terms & Conditions. Extract them into JSON for my lounge tracker.

Return ONLY a JSON code block. No commentary before or after it.

## Output shape

\`\`\`json
{
  "schema": "${RULES_SCHEMA}",
  "source_document": "<document name and version, or null>",
  "rules": [
    {
      "title": "<short name, e.g. 'Plaza Premium complimentary access'>",
      "card": { "bank": "<issuing bank>", "name": "<card product name>" },
      "network": "<lounge programme, e.g. 'Plaza Premium', 'Priority Pass', 'DragonPass', or the lounge name>",
      "countries": ["<country names, or 'worldwide'>"],
      "flight_scope": "any | international | domestic | null",
      "quota": {
        "principal": <visits for the principal cardholder, 0 if the T&C says none, null if unstated>,
        "supplementary": <visits for a supplementary cardholder, 0 if the T&C says none or 'not applicable', null if unstated>,
        "unlimited": <true only if stated as unlimited>,
        "period": "calendar_year | card_year | calendar_quarter | calendar_month | lifetime | null",
        "per_day_limit": <complimentary visits allowed per day, or null>
      },
      "condition": {
        "type": "none | min_spend | min_txn | null",
        "amount": <RM for min_spend, or null>,
        "count": <number of transactions for min_txn, or null>,
        "overseas_only": <true | false | null>,
        "window": "before | after | before_or_after | same_calendar_month | previous_calendar_month | previous_calendar_quarter | calendar_year | null",
        "days_before": <number or null>,
        "days_after": <number or null>,
        "sides_combine": <true if spend before AND after the visit add up to one total, false if one side must meet it alone, null if unstated>,
        "cumulative": <true if several transactions may add up, false if it must be one transaction, null if unstated>,
        "boundary_inclusive": <true if the last day itself counts (day 30 of 30), false if not, null if unstated>,
        "visit_day_counts": <true | false | null>,
        "same_spend_reusable": <true if one spend can qualify more than one visit, false if not, null if unstated>,
        "spend_holder": "same_holder | principal_only | any | null",
        "excluded_spend_types": ["<any of: ${SPEND_TYPE_LIST}>"],
        "excluded_spend_text": "<the exclusions in the T&C's own words, or null>"
      },
      "guest": {
        "allowed": <true | false | null>,
        "consumes_quota": <true if a guest uses one of the cardholder's visits, false if not, null if unstated>,
        "note": "<guest and family rules and discounts, or null>"
      },
      "penalty": {
        "amount": <RM charged if conditions aren't met, or null>,
        "note": "<what is charged, when and why, in the T&C's own words, or null>"
      },
      "entry_requirements": "<what to show at the lounge, or null>",
      "duration_hours": <stay limit in hours, or null>,
      "notes": "<anything else I must not forget, or null>",
      "effective_from": "YYYY-MM-DD | null",
      "effective_to": "YYYY-MM-DD | null",
      "confidence": "high | medium | low",
      "_source": {
        "<field name: quota, per_day_limit, condition, flight_scope, guest, penalty, effective_from>": "<verbatim sentence from the T&C>"
      }
    }
  ],
  "lounges": [
    {
      "name": "<lounge name>",
      "networks": ["<programme>"],
      "airport_code": "<IATA code, e.g. KUL>",
      "airport_name": "<airport name>",
      "country": "<country>",
      "terminal": "<terminal or null>",
      "zone": "<airside | landside | null>",
      "hours": "<opening hours or null>"
    }
  ]
}
\`\`\`

## Rules

1. **Never guess.** If the T&C does not state something, use \`null\`. The tracker treats null as "check with the bank"; a plausible wrong value could mean a surprise lounge fee. Apply this especially to the condition fields.
2. **Use the T&C's worked examples.** Example tables often settle what the clauses leave open. For instance, if a spend 30 days after the visit qualifies and one 31 days after does not, \`boundary_inclusive\` is true. If spends before and after a visit add up in an example, \`sides_combine\` is true. If two visits share one set of spends, \`same_spend_reusable\` is true.
3. **One rule object per card product and programme.** If a table lists several cards with different visit counts, emit one object per card. Only emit cards from "My cards" below, when that list is present. Use each card's name exactly as listed there, and add a note if the T&C uses a former or new name for it. If two tiers of one card have different terms, emit one object per tier and put the tier in the title.
4. **\`_source\` is mandatory** for every section you filled in. Quote the T&C verbatim. Quote a table row as it reads. If you can't quote anything for a value, the value should be null.
5. **Dates** are ISO \`YYYY-MM-DD\`. A document labelled only "Version: August 2026" gives \`effective_from\` as the first of that month, with confidence no higher than "medium", and the \`_source\` quotes the label. \`effective_to\` is null unless the T&C states an end date.
6. **\`spend_holder\`**: "principal_only" if only the principal's spend counts; "same_holder" if each cardholder's own spend counts for their own visits; "any" if all cards on the account count.
7. **\`excluded_spend_types\`** maps only exclusions the T&C names to the allowed values. Put the full wording, including anything that doesn't map, in \`excluded_spend_text\`.
8. **\`lounges\`**: only lounges the T&C lists by name. Don't copy a whole directory, and use an empty array when it only points to a website.
9. **\`confidence\`**: "high" only when the document is the bank's own T&C and is explicit about visits, the condition and the dates. Use "low" for a blog, comparison site, forum post, or unclear scan.`

export function buildRulesPrompt(cards = [], tncText = '') {
  const mine = cards.length
    ? `\n\n## My cards\n\n${cards.map((c) => `- ${c.bank} ${c.name}`.trim()).join('\n')}`
    : ''
  const tnc = tncText.trim() || '<<< PASTE THE FULL TERMS & CONDITIONS TEXT HERE, OR ATTACH THE PDF >>>'
  return `${RULES_BODY}${mine}\n\n## The T&C\n\n${tnc}`
}

export function buildLoungesPrompt(target = '', programmes = []) {
  const what = target.trim() || '<<< NAME THE AIRPORT OR PROGRAMME, E.G. KUL OR PRIORITY PASS AT SIN >>>'
  const mine = programmes.length
    ? `\n\nThe programmes my cards cover: ${programmes.join(', ')}. Spell a programme exactly this way when it is one of these, and list other programmes each lounge accepts too.`
    : ''
  return `You are building a list of airport lounges for my lounge tracker. Search the web and use each programme's official lounge finder or the airport's own website.

Find the lounges for: ${what}${mine}

Return ONLY a JSON code block. No commentary before or after it.

\`\`\`json
{
  "schema": "${LOUNGES_SCHEMA}",
  "lounges": [
    {
      "name": "<lounge name>",
      "networks": ["<every programme you can confirm it accepts, e.g. 'Plaza Premium', 'Priority Pass', 'DragonPass'>"],
      "airport_code": "<IATA code, e.g. KUL>",
      "airport_name": "<airport name>",
      "city": "<city>",
      "country": "<country>",
      "terminal": "<terminal or null>",
      "zone": "<airside | landside | null>",
      "hours": "<opening hours or null>",
      "notes": "<anything that limits access, such as international departures only, or null>",
      "source_url": "<the page that confirms this lounge and its programmes>",
      "confidence": "high | medium | low"
    }
  ]
}
\`\`\`

Rules:
1. **Never guess a programme.** My tracker uses \`networks\` to decide which of my cards get in, so a wrong programme could mean a surprise fee. List only programmes the source page confirms.
2. **\`source_url\` is mandatory.** If you can't find a page confirming a lounge, leave that lounge out.
3. If you can't browse the web, return \`"lounges": []\` rather than answering from memory.
4. Use null for anything the source doesn't state.
5. List each lounge once per terminal.`
}

export function buildTripPrompt() {
  return `You are reading a flight booking for my lounge tracker. I will attach an e-ticket or itinerary. I need the departures only, because a lounge is used before departing.

Return ONLY a JSON code block. No commentary before or after it.

\`\`\`json
{
  "schema": "${TRIPS_SCHEMA}",
  "trips": [
    {
      "name": "<short name for this flight, e.g. 'Tokyo' or 'Tokyo return'>",
      "date": "YYYY-MM-DD",
      "airport_code": "<IATA code of the airport I depart from>",
      "flight_number": "<e.g. MH88, or null>",
      "flight_type": "international | domestic | null"
    }
  ]
}
\`\`\`

Rules:
1. One object per departure, including the return flight and any connection where I change planes.
2. Use the local departure date as printed on the ticket.
3. \`flight_type\` is international if the departure and arrival airports are in different countries. Use null if you can't tell.
4. Leave out names, booking references, ticket numbers and prices.

## The booking

<<< ATTACH THE E-TICKET OR ITINERARY, OR PASTE ITS TEXT >>>`
}

export function buildSpendPrompt(card) {
  const name = card ? `${card.bank} ${card.name}`.trim() : '<my card>'
  return `You are extracting credit-card transactions for my lounge tracker. I will attach a statement or banking-app screenshot for my card: ${name}.

Return ONLY a JSON code block. No commentary before or after it.

\`\`\`json
{
  "schema": "${SPEND_SCHEMA}",
  "card": { "bank": "<issuing bank>", "name": "<card name>" },
  "transactions": [
    {
      "date": "YYYY-MM-DD",
      "amount": <positive RM amount; negative for refunds and credits>,
      "merchant": "<merchant as printed>",
      "type": "retail | instalment | balance_transfer | cash_advance | fee | ewallet | government | insurance | utilities | refund",
      "holder": "principal | supplementary | null",
      "overseas": <true if charged in a foreign currency or at a foreign merchant, else false>
    }
  ]
}
\`\`\`

Rules:
1. Use the transaction date, not the posting date, when both appear.
2. Dates on Malaysian statements read DD/MM. If the statement shows no year, take it from the statement date.
3. Leave out payments made to the card (such as "PAYMENT - THANK YOU"), but keep refunds as negative amounts.
4. Use "fee" for interest, late charges, annual fees and service tax. Use "instalment" for IPP/FPP/EPP plans.
5. Use "ewallet" for Touch 'n Go, GrabPay, Boost and ShopeePay reloads.
6. Never invent a transaction. If a row is unreadable, leave it out.

## The statement

<<< ATTACH THE STATEMENT OR SCREENSHOT, OR PASTE ITS TEXT >>>`
}
