# SIMULATION ONLY. Published by fault_injector on /sim/motor_fault_overlay; consumed only by motor_sim_node.
std_msgs/Header header
string injection_id
string scenario_id
bool active
string motor                 # left | right
bool override_current
float32 current_a
bool override_temperature
float32 temperature_c
bool encoder_stale           # freeze this wheel's encoder position
