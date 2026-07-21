import nextCoreWebVitals from "eslint-config-next/core-web-vitals";

const config = [
    ...nextCoreWebVitals,
    {
        ignores: ["prisma/**"],
    },
];

export default config;
