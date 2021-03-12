import * as util from '../util';

import { storeModule } from '../create-store';

/**
 * @typedef {import('../../../types/api').Profile} Profile
 */

/**
 * A dummy profile returned by the `profile` selector before the real profile
 * is fetched.
 *
 * @type Profile
 */
const initialProfile = {
  /** A map of features that are enabled for the current user. */
  features: {},
  /** A map of preference names and values. */
  preferences: {},
  /**
   * The authenticated user ID or null if the user is not logged in.
   */
  userid: null,
};

function init(settings) {
  return {
    /**
     * The app's authentication domain, from settings
     * FIXME: This returns an empty string when `authDomain` is missing
     * because other app logic has long assumed its string-y presence:
     * behavior when it's missing is undefined. This setting should be
     * enforced similarly to how `apiUrl` is enforced.
     */
    authDomain: settings?.authDomain ?? '',
    /**
     * Profile object fetched from the `/api/profile` endpoint.
     */
    profile: initialProfile,
  };
}

const update = {
  UPDATE_PROFILE: function (state, action) {
    return {
      profile: { ...action.profile },
    };
  },
};

const actions = util.actionTypes(update);

/**
 * Update the profile information for the current user.
 */
function updateProfile(profile) {
  return {
    type: actions.UPDATE_PROFILE,
    profile,
  };
}

/**
 *
 * @returns {string}
 */
function authDomain(state) {
  return state.authDomain;
}

/**
 * Return true if a user is logged in and false otherwise.
 *
 * @param {object} state - The application state
 */
function isLoggedIn(state) {
  return state.profile.userid !== null;
}

/**
 * Return true if a given feature flag is enabled for the current user.
 *
 * @param {object} state - The application state
 * @param {string} feature - The name of the feature flag. This matches the
 *        name of the feature flag as declared in the Hypothesis service.
 */
function isFeatureEnabled(state, feature) {
  return !!state.profile.features[feature];
}

/**
 * Return true if the user's profile has been fetched. This can be used to
 * distinguish the dummy profile returned by `profile()` on startup from a
 * logged-out user profile returned by the server.
 */
function hasFetchedProfile(state) {
  return state.profile !== initialProfile;
}

/**
 * Return the user's profile.
 *
 * Returns the current user's profile fetched from the `/api/profile` endpoint.
 *
 * If the profile has not yet been fetched yet, a dummy logged-out profile is
 * returned. This allows code to skip a null check.
 */
function profile(state) {
  return state.profile;
}

export default storeModule({
  init,
  namespace: 'session',
  update,

  actions: {
    updateProfile,
  },

  selectors: {
    authDomain,
    hasFetchedProfile,
    isFeatureEnabled,
    isLoggedIn,
    profile,
  },
});
