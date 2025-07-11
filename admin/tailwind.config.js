import { fontFamily } from "tailwindcss/defaultTheme";
import { createThemes } from "@shadcn/ui/themes";

export default {
    darkMode: "class",
    content: [
        "./index.html",
        "./src/**/*.{js,ts,jsx,tsx}",
    ],
    theme: {
        extend: {
            fontFamily: {
                sans: ["Inter", ...fontFamily.sans],
            },
            colors: {
                background: "#1f2937", // Tailwind gray-800
                foreground: "#f3f4f6", // Tailwind gray-100
                primary: {
                    DEFAULT: "#374151", // gray-700
                    foreground: "#f9fafb", // gray-50
                },
                muted: {
                    DEFAULT: "#4b5563", // gray-600
                    foreground: "#d1d5db", // gray-300
                },
                card: "#2d3748", // gray-800
                input: "#374151", // gray-700
            },
        },
    },
    plugins: [],
};
