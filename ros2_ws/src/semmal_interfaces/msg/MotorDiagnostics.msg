# Published by motor_sim_node on /motor/diagnostics at 50 Hz. Values come from the motor model of the Gazebo plant.
std_msgs/Header header
string source                # "gazebo_motor_model" in simulation
float32 left_current_a
float32 right_current_a
float32 left_temperature_c
float32 right_temperature_c
float64 left_commanded_rad_s
float64 right_commanded_rad_s
float64 left_measured_rad_s
float64 right_measured_rad_s
bool fault_overlay_active    # true while a simulation fault overlay is applied
