// Republishes Gazebo's simulation clock at a bounded rate.
//
// Gazebo publishes /clock once per physics step (1 kHz with a 1 ms step). Every node with
// use_sim_time subscribes to /clock, so ten Python nodes each spent 40-90% of a core just
// deserialising clock ticks, and the simulation fell behind real time. The bridge now writes
// the raw clock to /clock_raw; this node forwards it to /clock only when sim time has advanced
// by at least `period_ms` (default 20 ms = 50 Hz, the fastest robot-stack timer; measured: 338% -> 202%
// total CPU for the robot nodes vs 200 Hz). Safety timing runs on the steady clock, and
// sensor messages carry their own Gazebo timestamps, so nothing loses precision that it uses.
#include <rclcpp/rclcpp.hpp>
#include <rosgraph_msgs/msg/clock.hpp>

class ClockRelay : public rclcpp::Node {
public:
  ClockRelay() : Node("clock_relay") {
    period_ns_ = declare_parameter<int64_t>("period_ms", 20) * 1000000LL;
    // Same QoS as ros_gz_bridge's /clock publisher and rclcpp's TimeSource subscriber.
    pub_ = create_publisher<rosgraph_msgs::msg::Clock>("/clock", rclcpp::ClockQoS());
    sub_ = create_subscription<rosgraph_msgs::msg::Clock>(
      "/clock_raw", rclcpp::ClockQoS(), [this](rosgraph_msgs::msg::Clock::ConstSharedPtr m) {
        const int64_t t = rclcpp::Time(m->clock).nanoseconds();
        // Forward the first tick, any step of at least one period, and a backwards jump (world reset).
        if (last_ns_ < 0 || t - last_ns_ >= period_ns_ || t < last_ns_) {
          last_ns_ = t;
          pub_->publish(*m);
        }
      });
  }

private:
  int64_t period_ns_;
  int64_t last_ns_ = -1;
  rclcpp::Publisher<rosgraph_msgs::msg::Clock>::SharedPtr pub_;
  rclcpp::Subscription<rosgraph_msgs::msg::Clock>::SharedPtr sub_;
};

int main(int argc, char ** argv) {
  rclcpp::init(argc, argv);
  rclcpp::spin(std::make_shared<ClockRelay>());
  rclcpp::shutdown();
  return 0;
}
