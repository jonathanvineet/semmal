import os
from glob import glob
from setuptools import setup

package_name = 'semmal_incident'

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
    description='Canonical incident manifests and the durable local SQLite spool.',
    license='Apache-2.0',
    entry_points={
        'console_scripts': [
            'incident_recorder = semmal_incident.incident_recorder_node:main',
            'spool_status = semmal_incident.spool_cli:main',
        ],
    },
)
