import { useNotifications } from "@/hooks/useNotifications";
import { Loader2, BellOff, Trash2, Send, Monitor } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { showToast } from "@/lib/toast";
import { formatDistanceToNow } from "date-fns";

export function NotificationSettings() {
  const {
    isSupported,
    isAvailable,
    permission,
    isEnabled,
    preferences,
    subscriptions,
    isLoadingSubscriptions,
    enable,
    disable,
    updateEventPreference,
    removeDevice,
    sendTest,
    isSubscribing,
    isTesting,
  } = useNotifications();

  if (!isSupported) {
    return (
      <div className="bg-card border border-border rounded-lg p-6">
        <h2 className="text-lg font-semibold text-foreground mb-4">
          Push Notifications
        </h2>
        <div className="flex items-center gap-3 text-muted-foreground">
          <BellOff className="h-5 w-5" />
          <p className="text-sm">
            Push notifications are not supported in this browser.
          </p>
        </div>
      </div>
    );
  }

  if (!isAvailable) {
    return (
      <div className="bg-card border border-border rounded-lg p-6">
        <h2 className="text-lg font-semibold text-foreground mb-4">
          Push Notifications
        </h2>
        <div className="flex items-center gap-3 text-muted-foreground">
          <BellOff className="h-5 w-5" />
          <p className="text-sm">
            Push notifications are not configured on the server. Set VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY environment
            variables to enable.
          </p>
        </div>
      </div>
    );
  }

  if (permission === "denied") {
    return (
      <div className="bg-card border border-border rounded-lg p-6">
        <h2 className="text-lg font-semibold text-foreground mb-4">
          Push Notifications
        </h2>
        <div className="flex items-center gap-3 text-yellow-500">
          <BellOff className="h-5 w-5" />
          <p className="text-sm">
            Notification permission was denied. Please enable notifications in
            your browser settings for this site.
          </p>
        </div>
      </div>
    );
  }

  const handleEnable = async () => {
    try {
      await enable();
      showToast.success("Push notifications enabled");
    } catch {
      showToast.error("Failed to enable push notifications");
    }
  };

  const handleDisable = async () => {
    try {
      await disable();
      showToast.success("Push notifications disabled");
    } catch {
      showToast.error("Failed to disable push notifications");
    }
  };

  const handleTest = () => {
    sendTest(undefined, {
      onSuccess: (data) => {
        showToast.success(
          `Test notification sent to ${data.devicesNotified} device(s)`
        );
      },
      onError: () => {
        showToast.error("Failed to send test notification");
      },
    });
  };

  return (
    <div className="space-y-6">
      <div className="bg-card border border-border rounded-lg p-6">
        <h2 className="text-lg font-semibold text-foreground mb-6">
          Push Notifications
        </h2>

        <div className="space-y-6">
          <div className="flex flex-row items-center justify-between rounded-lg border border-border p-4">
            <div className="space-y-0.5">
              <Label htmlFor="notificationsEnabled" className="text-base">
                Enable push notifications
              </Label>
              <p className="text-sm text-muted-foreground">
                Receive notifications when the app is in the background
              </p>
            </div>
            <Switch
              id="notificationsEnabled"
              checked={isEnabled}
              disabled={isSubscribing}
              onCheckedChange={(checked) =>
                checked ? handleEnable() : handleDisable()
              }
            />
          </div>

          {isEnabled && (
            <>
              <div className="space-y-4">
                <h3 className="text-sm font-medium text-foreground">
                  Notification Events
                </h3>

                <div className="flex flex-row items-center justify-between rounded-lg border border-border p-4">
                  <div className="space-y-0.5">
                    <Label
                      htmlFor="notifPermission"
                      className="text-base"
                    >
                      Permission requests
                    </Label>
                    <p className="text-sm text-muted-foreground">
                      When the agent needs approval to proceed
                    </p>
                  </div>
                  <Switch
                    id="notifPermission"
                    checked={preferences.events.permissionAsked}
                    onCheckedChange={(checked) =>
                      updateEventPreference("permissionAsked", checked)
                    }
                  />
                </div>

                <div className="flex flex-row items-center justify-between rounded-lg border border-border p-4">
                  <div className="space-y-0.5">
                    <Label htmlFor="notifQuestion" className="text-base">
                      Agent questions
                    </Label>
                    <p className="text-sm text-muted-foreground">
                      When the agent has a question for you
                    </p>
                  </div>
                  <Switch
                    id="notifQuestion"
                    checked={preferences.events.questionAsked}
                    onCheckedChange={(checked) =>
                      updateEventPreference("questionAsked", checked)
                    }
                  />
                </div>

                <div className="flex flex-row items-center justify-between rounded-lg border border-border p-4">
                  <div className="space-y-0.5">
                    <Label htmlFor="notifError" className="text-base">
                      Session errors
                    </Label>
                    <p className="text-sm text-muted-foreground">
                      When a session encounters an error
                    </p>
                  </div>
                  <Switch
                    id="notifError"
                    checked={preferences.events.sessionError}
                    onCheckedChange={(checked) =>
                      updateEventPreference("sessionError", checked)
                    }
                  />
                </div>

                <div className="flex flex-row items-center justify-between rounded-lg border border-border p-4">
                  <div className="space-y-0.5">
                    <Label htmlFor="notifIdle" className="text-base">
                      Session completion
                    </Label>
                    <p className="text-sm text-muted-foreground">
                      When a session finishes processing
                    </p>
                  </div>
                  <Switch
                    id="notifIdle"
                    checked={preferences.events.sessionIdle}
                    onCheckedChange={(checked) =>
                      updateEventPreference("sessionIdle", checked)
                    }
                  />
                </div>
              </div>

              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleTest}
                  disabled={isTesting || subscriptions.length === 0}
                >
                  {isTesting ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  ) : (
                    <Send className="h-4 w-4 mr-2" />
                  )}
                  Send test notification
                </Button>
              </div>
            </>
          )}
        </div>
      </div>

      {isEnabled && (
        <div className="bg-card border border-border rounded-lg p-6">
          <h2 className="text-lg font-semibold text-foreground mb-4">
            Registered Devices
          </h2>

          {isLoadingSubscriptions ? (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : subscriptions.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No devices registered for push notifications.
            </p>
          ) : (
            <div className="space-y-3">
              {subscriptions.map((sub) => (
                <div
                  key={sub.id}
                  className="flex items-center justify-between rounded-lg border border-border p-3"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <Monitor className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">
                        {sub.deviceName ?? (sub.endpoint.length > 60 ? sub.endpoint.slice(0, 60) + "..." : sub.endpoint)}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {sub.lastUsedAt
                          ? `Last used ${formatDistanceToNow(sub.lastUsedAt, { addSuffix: true })}`
                          : `Added ${formatDistanceToNow(sub.createdAt, { addSuffix: true })}`}
                      </p>
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="text-muted-foreground hover:text-destructive flex-shrink-0"
                    onClick={() => removeDevice(sub.id)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
