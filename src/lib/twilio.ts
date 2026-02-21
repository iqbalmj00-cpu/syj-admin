const TWILIO_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH = process.env.TWILIO_AUTH_TOKEN;
const BASE = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_SID}`;

function authHeader() {
    return "Basic " + Buffer.from(`${TWILIO_SID}:${TWILIO_AUTH}`).toString("base64");
}

/** Release (delete) a Twilio phone number */
export async function releasePhoneNumber(phoneSid: string) {
    if (!TWILIO_SID || !TWILIO_AUTH) throw new Error("Twilio not configured");
    const url = `${BASE}/IncomingPhoneNumbers/${phoneSid}.json`;
    const res = await fetch(url, {
        method: "DELETE",
        headers: { Authorization: authHeader() },
    });
    if (!res.ok && res.status !== 404) {
        const body = await res.text();
        throw new Error(`Twilio release failed: ${res.status} ${body}`);
    }
    return true;
}
