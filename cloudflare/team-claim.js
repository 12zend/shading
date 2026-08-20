const TEAM_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

const deriveTeamIdFromClaim = async claimToken => {
    if (!/^[a-f0-9]{64}$/.test(String(claimToken || ''))) return null;
    const encoded = new TextEncoder().encode(claimToken);
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', encoded));
    let teamId = '';
    for (let index = 0; index < 20; index++) {
        teamId += TEAM_ALPHABET[digest[index] % TEAM_ALPHABET.length];
    }
    return teamId;
};

export {
    TEAM_ALPHABET,
    deriveTeamIdFromClaim
};
