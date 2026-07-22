/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        twin: {
          bg: "#eef3f7",
          page: "#f6f8fb",
          panel: "#f8fbfd",
          surface: "#ffffff",
          border: "#d2dde8",
          orange: "#e35f1f",
          blue: "#2a63a8",
          green: "#22935e",
          cyan: "#0ea5c9",
          success: "#22935e",
          warning: "#b8790f",
          critical: "#cc3f3f",
          text: "#0f1b2d",
          muted: "#43556b",
          subtle: "#64707e"
        }
      },
      boxShadow: {
        glow: "0 16px 42px rgba(20, 32, 51, 0.14)",
        card: "0 10px 28px -6px rgba(20, 32, 51, 0.1)"
      },
      transitionTimingFunction: {
        "out-soft": "cubic-bezier(0.16, 1, 0.3, 1)"
      }
    }
  },
  plugins: []
};
