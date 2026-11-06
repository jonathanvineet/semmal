from setuptools import setup

package_name = 'semmal_gateway'

setup(
    name=package_name,
    version='0.1.0',
    packages=[package_name],
    data_files=[
        ('share/ament_index/resource_index/packages', ['resource/' + package_name]),
        ('share/' + package_name, ['package.xml']),
    ],
    install_requires=['setuptools'],
    zip_safe=True,
    maintainer='semmal',
    maintainer_email='cvineetjonathan@gmail.com',
    description='Localhost bridge: robot state file + mission/hold/keyframe API for the robot master agent.',
    license='Apache-2.0',
    entry_points={'console_scripts': ['gateway_node = semmal_gateway.gateway_node:main']},
)
