{
  "expo": {
    "name": "Forex Alert Terminal",
    "slug": "forex-alert-terminal",
    "version": "1.0.0",
    "orientation": "portrait",
    "icon": "./assets/icon.png",
    "userInterfaceStyle": "dark",
    "splash": {
      "image": "./assets/splash.png",
      "resizeMode": "contain",
      "backgroundColor": "#020617"
    },
    "ios": {
      "supportsTablet": true,
      "infoPlist": {
        "UIBackgroundModes": [
          "fetch",
          "audio"
        ]
      }
    },
    "android": {
      "adaptiveIcon": {
        "foregroundImage": "./assets/adaptive-icon.png",
        "backgroundColor": "#020617"
      },
      "permissions": [
        "RECEIVE_BOOT_COMPLETED",
        "WAKE_LOCK"
      ]
    }
  }
}