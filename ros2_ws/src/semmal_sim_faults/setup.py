import os
from glob import glob
from setuptools import setup

package_name = 'semmal_sim_faults'

setup(
    name=package_name,
    version='0.1.0',
    packages=[package_name],
    data_files=[
        ('share/ament_index/resource_index/packages', ['resource/' + package_name]),
        ('share/' + package_name, ['package.xml']),
        (os.path.join('share', package_name, 'scenarios'), glob('scenarios/*')),
    ],
    install_requires=['setuptools'],
    zip_safe=True,
    maintainer='semmal',
    maintainer_email='cvineetjonathan@gmail.com',
    description='SIMULATION-ONLY fault injector. Refuses to run unless APP_MODE=simulation.',
    license='Apache-2.0',
    entry_points={
        'console_scripts': [
            'fault_injector = semmal_sim_faults.fault_injector_node:main',
        ],
    },
)
