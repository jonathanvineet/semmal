cmake_minimum_required(VERSION 3.8)
project(semmal_interfaces)
find_package(ament_cmake REQUIRED)
find_package(rosidl_default_generators REQUIRED)
find_package(std_msgs REQUIRED)
find_package(builtin_interfaces REQUIRED)
rosidl_generate_interfaces(${PROJECT_NAME}
  "msg/SafetyState.msg"
  "msg/FaultEvent.msg"
  "msg/MotorDiagnostics.msg"
  "msg/FaultOverlay.msg"
  "msg/RobotState.msg"
  "srv/InjectFault.srv"
  "srv/RequestRecovery.srv"
  "action/ExecuteMission.action"
  DEPENDENCIES std_msgs builtin_interfaces
)
ament_export_dependencies(rosidl_default_runtime)
ament_package()
