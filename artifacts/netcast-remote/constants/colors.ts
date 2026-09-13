/**
 * Semantic design tokens for the mobile app.
 *
 * These tokens mirror the naming conventions used in web artifacts (index.css)
 * so that multi-artifact projects share a cohesive visual identity.
 *
 * Replace the placeholder values below with values that match the project's
 * brand. If a sibling web artifact exists, read its index.css and convert the
 * HSL values to hex so both artifacts use the same palette.
 *
 * To add dark mode, add a `dark` key with the same token names.
 * The useColors() hook will automatically pick it up.
 */

const colors = {
  light: {
    // Legacy aliases (kept for backward compatibility)
    text: '#F4F7FB',
    tint: '#5CE1E6',

    // Core surfaces
    background: '#09111D',
    foreground: '#F4F7FB',

    // Cards / elevated surfaces
    card: '#111E2D',
    cardForeground: '#F4F7FB',

    // Primary action color (buttons, links, active states)
    primary: '#5CE1E6',
    primaryForeground: '#07131C',

    // Secondary / less-emphasis interactive surfaces
    secondary: '#1A2B3D',
    secondaryForeground: '#DDE8F4',

    // Muted / subdued elements (dividers, timestamps, placeholders)
    muted: '#142234',
    mutedForeground: '#8EA2B8',

    // Accent highlights (badges, selected items, focus rings)
    accent: '#183948',
    accentForeground: '#8FF4F2',

    // Destructive actions (delete, error states)
    destructive: '#FF6E72',
    destructiveForeground: '#FFF7F7',

    // Borders and input outlines
    border: '#26384C',
    input: '#1A2B3D',
  },

  // Border radius (in px). Sync from the sibling web artifact's --radius
  // CSS variable. This value applies to cards, buttons, inputs, and modals.
  radius: 8,
};

// Keep the scaffold's light/dark shape for useColors while also exposing the
// active light tokens directly for small, static StyleSheet declarations.
export default { ...colors, ...colors.light };
