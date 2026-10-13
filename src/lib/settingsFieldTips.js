const helpByLabel = {
  'api base url': 'Base URL for the Traccar API used for devices, positions, and live data. Use the configured proxy path or the server API URL.',
  'vehicle api base url': 'Base URL for this app’s Vehicle API. This is separate from the Traccar API URL.',
  'username (email)': 'Traccar account username used by this app. It is not an email alias or a new account signup field.',
  username: 'Login name for this Vehicle App user. Use it when signing in to the app.',
  password: 'Password for the selected account. When editing an existing user, leave blank to keep the current password.',
  'poll interval (ms)': 'How often the app asks Traccar for updated device data. Lower values refresh more often and make more requests.',
  'realtime hours': 'How many recent hours of positions to keep in the live map view.',
  'movement threshold (m)': 'Minimum distance in meters before a new position counts as movement. Raise it to filter GPS drift; lower it to detect smaller movements.',
  'display units': 'Choose whether distances and speeds are shown in US customary or metric units.',
  theme: 'Choose the app color theme, or follow the device setting with Auto.',
  'device source': 'Choose whether the vehicle list comes directly from Traccar or from the Vehicle App catalog.',
  'edit vehicle': 'Choose a catalog vehicle to edit, or select New vehicle to add one.',
  name: 'Display name used to identify this record in the app.',
  vin: 'Vehicle Identification Number. Enter the 17-character VIN when available.',
  year: 'Model year of the vehicle.',
  make: 'Vehicle manufacturer.',
  model: 'Vehicle model name.',
  'device protocol profile': 'Profile used to translate device attributes into vehicle status fields.',
  'traccar device': 'Traccar hardware device currently associated with this catalog vehicle.',
  'effective from': 'Date and time when this device-to-vehicle assignment begins.',
  notes: 'Optional notes for your own reference.',
  'sender mailbox': 'Optional sender mailbox for this vehicle. Leave blank to use the default email sender.',
  vehicle: 'Choose which vehicle these settings apply to. An All vehicles option applies the setting across the catalog.',
  'copy from vehicle': 'Copy the selected vehicle’s speed-band thresholds and colors to the current vehicle.',
  'latitude': 'North–south coordinate in decimal degrees, from -90 to 90.',
  'longitude': 'East–west coordinate in decimal degrees, from -180 to 180.',
  radius: 'Distance from the saved coordinate that counts as being at this place. Enter yards.',
  'track role': 'Classifies how this place is used in a track or course.',
  'track or course name': 'Optional track, circuit, or course name. Existing names are suggested; new names are allowed.',
  'tag name': 'Name for this trip tag.',
  color: 'Color used to identify this tag in the app.',
  'profile to edit': 'Select the device protocol profile whose mapping you want to edit.',
  'profile name': 'Name shown for this device protocol profile.',
  'mapping json': 'JSON mapping that translates raw device attributes into app fields. Keep valid JSON syntax.',
  'oauth client id': 'Client ID from your Bouncie developer application.',
  'client secret': 'Client secret for the Bouncie application. The saved secret is not displayed; enter a value only to replace it.',
  'redirect url': 'OAuth callback URL registered for this Bouncie application. It must exactly match the provider configuration.',
  'import from': 'First date to include in the Bouncie history import.',
  'import through': 'Last date to include in the Bouncie history import.',
  'alert email address': 'Email address that should receive this user’s driving alerts.',
  'maximum emails per day': 'Daily limit for alert messages sent to this address.',
  'during quiet hours': 'Enable a daily period when alert messages are delayed or suppressed.',
  'from': 'Start of the daily quiet-hours period, using the selected time zone.',
  'until': 'End of the daily quiet-hours period, using the selected time zone.',
  'time zone': 'Time zone used to interpret quiet-hour start and end times.',
  'verification code': 'Code sent to the email address to confirm that you can receive alerts there.',
  'phone number': 'Mobile number for SMS alerts. Use international E.164 format, for example +15551234567.',
  'maximum texts per day': 'Daily limit for alert text messages sent to this number.',
  'maximum texts per day': 'Daily limit for alert text messages sent to this number.',
  'twilio account': 'Select the Twilio account used for SMS testing and delivery.',
  'account name': 'Friendly name to distinguish this provider account from other accounts.',
  'account sid': 'Twilio Account SID that identifies the account.',
  'api key sid': 'Twilio API Key SID used to authenticate API requests.',
  'api key secret': 'Twilio API Key secret. Saved secrets are hidden; enter a value only to replace it.',
  'from number': 'Twilio phone number used as the sender. Use E.164 format.',
  'webhook base url': 'Public base URL that Twilio should call for inbound messages and delivery callbacks.',
  'webhook username': 'Username Twilio must send when authenticating inbound webhook requests.',
  'webhook password': 'Password Twilio must send when authenticating inbound webhook requests.',
  'test account sid': 'Optional Twilio test account SID for magic-number testing.',
  'test auth token': 'Optional test account token. Saved tokens are hidden; enter a value only to replace it.',
  'textbelt account': 'Select the Textbelt account to edit.',
  'api key': 'Provider API key. Saved keys are hidden; enter a value only to replace it.',
  'webhook secret': 'Secret used to validate provider webhook requests.',
  'webhook token': 'Token used to validate provider webhook requests.',
  'sender email': 'Email address used as the sender for messages from this provider account.',
  'sender name': 'Name recipients see as the sender of alert emails.',
  'default graph sender mailbox': 'Default Microsoft Graph mailbox used to send alert emails.',
  'email account': 'Select the email provider account to edit.',
  'account sid': 'Provider account identifier supplied by your messaging provider.',
  role: 'Administrators can manage shared settings and user access. Regular users have the permissions assigned to them.',
  'first name': 'First name shown when identifying this user.',
  'last name': 'Last name shown when identifying this user.',
  email: 'Contact email address for this user. It is not used as a login unless it matches the username.',
  'group name': 'Name used to identify this access group.',
  'auto-access future devices': 'Automatically grant this user or group access when new Traccar devices are added.',
  'enable this account': 'Allow this provider account to be used for message delivery.',
  'use as default email provider account': 'Use this account when no vehicle-specific email sender is configured.',
  'use as default sms provider account': 'Use this account when no vehicle-specific SMS sender is configured.',
  'clear api key': 'Remove the encrypted API key saved for this provider account.',
  'clear saved webhook secret': 'Remove the encrypted webhook secret saved for this provider account.',
  'clear saved webhook token': 'Remove the encrypted webhook token saved for this provider account.',
}

const helpBySectionAndLabel = {
  'general|username': 'Username for the Traccar server. It is used with the Traccar API password below; it is not a new email or alias signup field.',
  'general|password': 'Password for the Traccar account above. It is stored in this browser’s app settings and sent to Traccar when the app makes API requests.',
  'users and groups|username': 'Unique login name for this Vehicle App user.',
  'users and groups|password': 'Set a password for this user. When editing an existing user, leave it blank to keep the current password.',
  'vehicle catalog|name': 'Display name for this catalog vehicle. It appears in vehicle lists and reports.',
  'named places|name': 'Name for this saved place, such as Home or Office.',
  'trip tags|name': 'Name for this trip tag.',
  'named places|vehicle': 'Limit this saved place to one vehicle, or leave All vehicles selected to make it shared.',
  'trip tags|vehicle': 'Limit this tag to one vehicle, or leave Global selected to make it available across vehicles.',
  'speed bands|vehicle': 'Choose the vehicle whose speed thresholds and colors you want to edit.',
  'device protocol profile editor|selected profile': 'Choose the device profile to inspect or edit. Changes apply to every vehicle assigned to that profile.',
  'device protocol profile editor|field mappings and conversions json': 'JSON definitions that map raw device attributes to app fields and describe unit conversions. Keep valid JSON syntax.',
}

const normalize = (text) => text.toLocaleLowerCase().replace(/\s+/g, ' ').trim().replace(/\s*\(configured;.*?\)/g, '').replace(/\s*\(.*?\)/g, '').trim()

function labelText(label) {
  const copy = label.cloneNode(true)
  copy.querySelectorAll('input, select, textarea, datalist, .admin-switch-slider, .status-card-popup-switch-track').forEach((node) => node.remove())
  return copy.textContent.replace(/\s+/g, ' ').trim()
}

function fallbackHelp(label, field, section) {
  const name = label || field?.getAttribute('aria-label') || field?.name || field?.placeholder || 'Setting'
  const context = section ? ` for ${section}` : ''
  if (!field) return `Configure ${name}${context}.`
  if (field.type === 'checkbox') return `Turn “${name}” on or off${context}.`
  if (field.tagName === 'SELECT') return `Choose the ${name.toLocaleLowerCase()}${context}.`
  if (field.type === 'number') {
    const limits = [field.min && `minimum ${field.min}`, field.max && `maximum ${field.max}`, field.step && field.step !== '1' && `step ${field.step}`].filter(Boolean)
    return `Enter the ${name.toLocaleLowerCase()}${context}${limits.length ? ` (${limits.join(', ')})` : ''}.`
  }
  if (field.type === 'email') return `Enter the email address used for ${name.toLocaleLowerCase()}${context}.`
  if (field.type === 'password') return `Enter the password or secret for ${name.toLocaleLowerCase()}${context}.`
  return `Enter the ${name.toLocaleLowerCase()}${context}.`
}

export function addSettingsFieldTips(root) {
  if (!root) return
  root.querySelectorAll('label').forEach((label) => {
    const text = labelText(label)
    const key = normalize(text)
    const section = label.closest('.profile-editor')?.querySelector(':scope > h4')?.textContent.trim() || ''
    const help = helpBySectionAndLabel[`${normalize(section)}|${key}`]
      || helpByLabel[key]
      || fallbackHelp(text, label.querySelector('input, select, textarea'), section)
    if (!help || label.dataset.fieldTip === help) return
    label.dataset.fieldTip = help
    label.setAttribute('aria-description', help)
    label.querySelectorAll('input, select, textarea').forEach((field) => {
      if (!field.hasAttribute('aria-description')) field.setAttribute('aria-description', help)
      if (field.type === 'email' && !field.hasAttribute('data-allow-email-autofill')) {
        field.setAttribute('autocomplete', 'off')
        if (!field.name) {
          const sectionName = normalize(section).replace(/[^a-z0-9]+/g, '-')
          const fieldName = key.replace(/[^a-z0-9]+/g, '-')
          field.setAttribute('name', `settings-${sectionName}-${fieldName}`)
        }
      }
    })
  })
}
