# Published by safety_supervisor on /safety/state (reliable, transient_local, 10 Hz + on change).
std_msgs/Header header
string NORMAL=NORMAL
string DEGRADED=DEGRADED
string STOPPING=STOPPING
string E_STOP=E_STOP
string RECOVERY_REQUIRED=RECOVERY_REQUIRED
string state
string reason
string[] active_fault_codes
bool motion_permitted        # false => supervisor is forcing zero velocity
bool latched                 # true in E_STOP / RECOVERY_REQUIRED until approved recovery
uint32 transition_seq        # increments on every state change
builtin_interfaces/Time last_transition
