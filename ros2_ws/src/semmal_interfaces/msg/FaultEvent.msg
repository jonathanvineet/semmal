# Published by diagnostics_node on /fault_events (reliable, depth 50). One event per raise and per clear.
std_msgs/Header header
string event_id              # uuid4
string fault_code            # e.g. LEFT_MOTOR_OVERCURRENT
string SEVERITY_INFO=info
string SEVERITY_WARNING=warning
string SEVERITY_CRITICAL=critical
string severity
bool active                  # true = raised, false = cleared
string component             # e.g. left_motor
string message
# Sensor summary at detection time (units: A, degC)
float32 left_motor_current_a
float32 left_motor_temperature_c
float32 right_motor_current_a
float32 right_motor_temperature_c
bool left_encoder_stale
bool right_encoder_stale
