#!/bin/bash
# docker-run.sh
# Helper script to build and run HASH Core with Docker

set -e

show_help() {
    echo "Usage: $0 [COMMAND]"
    echo ""
    echo "Commands:"
    echo "  dev       Build and run in development mode (port 3000)"
    echo "  prod      Build and run in production mode (port 8080)"
    echo "  build     Build both development and production images"
    echo "  clean     Remove all Docker images and containers"
    echo "  help      Show this help message"
    echo ""
    echo "Examples:"
    echo "  $0 dev    # Start development server"
    echo "  $0 prod   # Start production server"
}

build_images() {
    echo "Building Docker images..."
    docker-compose build
}

run_dev() {
    echo "Starting HASH Core in development mode..."
    echo "Application will be available at http://localhost:3000"
    docker-compose --profile development up hash-core-dev
}

run_prod() {
    echo "Starting HASH Core in production mode..."
    echo "Application will be available at http://localhost:8080"
    docker-compose --profile production up hash-core-prod
}

clean_docker() {
    echo "Cleaning up Docker images and containers..."
    docker-compose down --remove-orphans
    docker-compose --profile development down --remove-orphans
    docker-compose --profile production down --remove-orphans
    
    # Remove images
    docker images | grep hash-core | awk '{print $3}' | xargs -r docker rmi
    
    echo "Cleanup completed!"
}

case "${1:-help}" in
    "dev")
        build_images
        run_dev
        ;;
    "prod")
        build_images
        run_prod
        ;;
    "build")
        build_images
        ;;
    "clean")
        clean_docker
        ;;
    "help"|"--help"|"-h")
        show_help
        ;;
    *)
        echo "Unknown command: $1"
        echo ""
        show_help
        exit 1
        ;;
esac 